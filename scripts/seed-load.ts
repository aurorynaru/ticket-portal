import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateId } from '@better-auth/core/utils/id';
import { openDatabase, closeDatabase } from '../src/db/connection.js';
import { runMigrations } from '../src/db/migrations.js';
import { createAuth } from '../src/auth/auth.js';
import { createProfile } from '../src/auth/profiles.js';
import type { AppConfig } from '../src/config/env.js';

/**
 * Deterministic synthetic workload for the 100-user load test (P6.3).
 *
 * Creates an ISOLATED database (never the dev/production DB) with:
 *   - 101 users (1 admin + 100 load users) with a shared known password
 *   - 10 teams with round-robin membership
 *   - 20,000 tickets across teams with a realistic status mix
 *   - 3 comments per ticket
 * and writes load/seed-manifest.json describing every user's credentials and
 * the tickets they may read/write. All data is synthetic.
 *
 * Env:
 *   LOAD_DB        (default .local/load/load.db)
 *   LOAD_UPLOADS   (default .local/load/uploads)
 *   LOAD_USERS     (default 101)
 *   LOAD_TEAMS     (default 10)
 *   LOAD_TICKETS   (default 20000)
 *   LOAD_COMMENTS  (default 3)
 *   LOAD_PASSWORD  (default LoadPass12345!)
 *   BETTER_AUTH_SECRET  (required, >= 32 chars; must match the load app)
 *   BETTER_AUTH_URL     (default http://127.0.0.1:3199)
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, '..');

const env = process.env;
const num = (name: string, dflt: number): number => {
  const v = Number.parseInt(env[name] ?? '', 10);
  return Number.isFinite(v) && v > 0 ? v : dflt;
};

const usersCount = num('LOAD_USERS', 101);
const teamsCount = num('LOAD_TEAMS', 10);
const ticketsCount = num('LOAD_TICKETS', 20000);
const commentsPerTicket = num('LOAD_COMMENTS', 3);
const password = env.LOAD_PASSWORD ?? 'LoadPass12345!';
const secret = env.BETTER_AUTH_SECRET ?? '';
const baseUrl = env.BETTER_AUTH_URL ?? 'http://127.0.0.1:3199';
const loadDb = path.resolve(env.LOAD_DB ?? path.join(appRoot, '.local', 'load', 'load.db'));
const loadUploads = path.resolve(env.LOAD_UPLOADS ?? path.join(appRoot, '.local', 'load', 'uploads'));

if (secret.length < 32) {
  console.error('BETTER_AUTH_SECRET must be set (>= 32 chars) and match the load app instance.');
  process.exit(2);
}

// Deterministic PRNG so re-seeding produces the same workload shape.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(42);
const pick = <T,>(arr: T[]): T => arr[Math.floor(rand() * arr.length)];

async function main(): Promise<void> {
  fs.mkdirSync(path.dirname(loadDb), { recursive: true });
  fs.mkdirSync(loadUploads, { recursive: true });

  const config: AppConfig = {
    nodeEnv: 'test',
    isProduction: false,
    port: 0,
    databasePath: loadDb,
    uploadDir: loadUploads,
    betterAuthUrl: baseUrl,
    betterAuthSecret: secret,
    sessionTrustedOrigin: baseUrl,
    defaultTimezone: 'UTC',
    maxUploadBytes: 10 * 1024 * 1024,
    notificationPollSeconds: 45,
    rateLimitMax: 100000,
    rateLimitAuthMax: 100000,
    logLevel: 'silent',
  };

  const db = openDatabase(loadDb);
  const auth = createAuth(db, config);
  try {
    const context = await auth.$context;
    await context.runMigrations();
    runMigrations(db, path.join(appRoot, 'migrations'));

    const internal = context.internalAdapter;
    const passwordApi = context.password;

    // --- users -----------------------------------------------------------
    const userIds: string[] = [];
    for (let i = 0; i < usersCount; i++) {
      const isAdmin = i === 0;
      const email = `load-${String(i).padStart(3, '0')}@load.local`;
      const existing = db.prepare('SELECT id FROM user WHERE email = ?').get(email) as
        | { id: string }
        | undefined;
      let userId: string;
      if (existing) {
        userId = existing.id;
      } else {
        userId = generateId(32);
        const hash = await passwordApi.hash(password);
        await internal.createUser(
          {
            id: userId,
            email,
            name: `Load User ${i}`,
            emailVerified: true,
            role: isAdmin ? 'admin' : 'user',
          },
          'load-seed',
        );
        await internal.createAccount({
          id: generateId(32),
          userId,
          providerId: 'credential',
          accountId: userId,
          password: hash,
        });
        createProfile(db, userId, isAdmin ? 'manager' : 'user', 'UTC');
      }
      userIds.push(userId);
    }

    // --- teams + membership ----------------------------------------------
    const teamIds: string[] = [];
    const insertTeam = db.prepare('INSERT OR IGNORE INTO app_teams (id, name, created_at) VALUES (?, ?, ?)');
    const insertMember = db.prepare('INSERT OR IGNORE INTO app_team_members (team_id, user_id) VALUES (?, ?)');
    for (let t = 0; t < teamsCount; t++) {
      const teamId = `team-load-${t}`;
      insertTeam.run(teamId, `Load Team ${t}`, Date.now());
      teamIds.push(teamId);
    }
    for (let i = 0; i < usersCount; i++) {
      const primary = teamIds[i % teamsCount];
      insertMember.run(primary, userIds[i]);
      if (i === 0) {
        for (const teamId of teamIds) insertMember.run(teamId, userIds[0]);
      }
    }

    // --- tickets + comments ----------------------------------------------
    const now = Date.now();
    const dayMs = 24 * 3600 * 1000;
    const insertSeq = db.prepare('INSERT INTO app_ticket_number_seq DEFAULT VALUES');
    const insertTicket = db.prepare(
      `INSERT INTO app_tickets (id, ticket_no, title, description, kind, category_id, team_id,
        visibility, priority, status, created_by, assigned_to, due_at, resolved_at, closed_at,
        version, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'TEAM', ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    );
    const insertComment = db.prepare(
      `INSERT INTO app_ticket_comments (id, ticket_id, author_id, content, is_internal, created_at)
       VALUES (?, ?, ?, ?, 0, ?)`,
    );

    const teamMembers: Record<string, string[]> = {};
    for (const teamId of teamIds) teamMembers[teamId] = [];
    for (let i = 0; i < usersCount; i++) {
      teamMembers[teamIds[i % teamsCount]].push(userIds[i]);
      if (i === 0) for (const teamId of teamIds) teamMembers[teamId].push(userIds[0]);
    }

    const kinds = ['TASK', 'INCIDENT', 'REQUEST', 'BUG'];
    const priorities = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
    const categories = ['cat-general', 'cat-it-support', 'cat-infrastructure', 'cat-security', 'cat-other'];

    const ticketIds: string[] = [];
    const ticketTeam: Record<string, string> = {};
    const ticketCreator: Record<string, string> = {};
    const ticketStatus: Record<string, string> = {};

    db.exec('BEGIN');
    try {
      for (let i = 0; i < ticketsCount; i++) {
        const id = `lt-${String(i).padStart(6, '0')}`;
        const teamId = teamIds[i % teamsCount];
        const creator = pick(teamMembers[teamId]);
        const createdAt = now - Math.floor(rand() * 30 * dayMs);
        const r = rand();
        let status: string;
        if (r < 0.55) status = 'OPEN';
        else if (r < 0.7) status = 'IN_PROGRESS';
        else if (r < 0.78) status = 'ASSIGNED';
        else if (r < 0.83) status = 'BLOCKED';
        else if (r < 0.93) status = 'RESOLVED';
        else status = 'CLOSED';
        const assignee =
          status === 'OPEN' ? null : pick(teamMembers[teamId]);
        const resolvedAt = status === 'RESOLVED' || status === 'CLOSED' ? createdAt + Math.floor(rand() * 5 * dayMs) : null;
        const closedAt = status === 'CLOSED' ? (resolvedAt ?? createdAt) + 3600_000 : null;
        const dueAt = rand() < 0.3 ? createdAt + Math.floor((rand() * 28 - 14) * dayMs) : null;
        const updatedAt = Math.min(now, createdAt + Math.floor(rand() * 10 * dayMs));

        insertSeq.run();
        const ticketNo = Number(db.prepare('SELECT last_insert_rowid() AS id').get().id);
        insertTicket.run(
          id,
          ticketNo,
          `Load ticket ${i} synthetic workload item`,
          'Synthetic load-test ticket. Not real work; safe to ignore.',
          pick(kinds),
          pick(categories),
          teamId,
          pick(priorities),
          status,
          creator,
          assignee,
          dueAt,
          resolvedAt,
          closedAt,
          createdAt,
          updatedAt,
        );
        ticketIds.push(id);
        ticketTeam[id] = teamId;
        ticketCreator[id] = creator;
        ticketStatus[id] = status;

        for (let c = 0; c < commentsPerTicket; c++) {
          insertComment.run(
            `lc-${i}-${c}`,
            id,
            pick(teamMembers[teamId]),
            `Load comment ${c} for ticket ${i}.`,
            createdAt + (c + 1) * 600_000,
          );
        }
      }
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }

    // --- manifest ----------------------------------------------------------
    const perUserTickets: Record<string, string[]> = {};
    const perUserOwn: Record<string, string[]> = {};
    const perUserOpenTickets: Record<string, string[]> = {};
    const perUserOwnOpen: Record<string, string[]> = {};
    for (const uid of userIds) {
      perUserTickets[uid] = [];
      perUserOwn[uid] = [];
      perUserOpenTickets[uid] = [];
      perUserOwnOpen[uid] = [];
    }
    for (const id of ticketIds) {
      const teamId = ticketTeam[id];
      const open = ticketStatus[id] !== 'CLOSED';
      for (const member of teamMembers[teamId]) {
        if (perUserTickets[member].length < 40) perUserTickets[member].push(id);
        if (open && perUserOpenTickets[member].length < 40) perUserOpenTickets[member].push(id);
      }
      const creator = ticketCreator[id];
      if (perUserOwn[creator].length < 20) perUserOwn[creator].push(id);
      if (open && perUserOwnOpen[creator].length < 20) perUserOwnOpen[creator].push(id);
    }

    const manifest = {
      createdAt: new Date().toISOString(),
      database: loadDb,
      uploads: loadUploads,
      baseUrl,
      totals: {
        users: usersCount,
        teams: teamsCount,
        tickets: ticketsCount,
        comments: ticketsCount * commentsPerTicket,
      },
      users: userIds.map((uid, i) => ({
        id: uid,
        email: `load-${String(i).padStart(3, '0')}@load.local`,
        password,
        teamId: i === 0 ? teamIds[0] : teamIds[i % teamsCount],
        tickets: perUserTickets[uid],
        own: perUserOwn[uid],
        openTickets: perUserOpenTickets[uid],
        ownOpen: perUserOwnOpen[uid],
      })),
    };
    const manifestPath = path.join(appRoot, 'load', 'seed-manifest.json');
    fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
    fs.writeFileSync(manifestPath, JSON.stringify(manifest));

    console.log(
      JSON.stringify(
        {
        database: loadDb,
        manifest: manifestPath,
        users: usersCount,
        teams: teamsCount,
        tickets: ticketsCount,
        comments: ticketsCount * commentsPerTicket,
      },
        null,
        2,
      ),
    );
  } finally {
    closeDatabase(db);
  }
}

main().catch((err) => {
  console.error('Load seed failed:', err);
  process.exit(1);
});