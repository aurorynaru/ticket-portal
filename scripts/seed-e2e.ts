import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateId } from '@better-auth/core/utils/id';
import { loadConfig } from '../src/config/env.js';
import { openDatabase, closeDatabase } from '../src/db/connection.js';
import { runMigrations } from '../src/db/migrations.js';
import { createAuth } from '../src/auth/auth.js';
import { createProfile } from '../src/auth/profiles.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, '..');

interface SeedUser {
  email: string;
  name: string;
  password: string;
  role: 'admin' | 'user';
  accessLevel: 'manager' | 'user' | 'viewer';
}

// Synthetic, non-production credentials for local/E2E use only.
const USERS: SeedUser[] = [
  { email: 'admin@example.com', name: 'Admin', password: 'Admin12345!', role: 'admin', accessLevel: 'manager' },
  { email: 'manager@example.com', name: 'Manager', password: 'Manager12345!', role: 'user', accessLevel: 'manager' },
  { email: 'user@example.com', name: 'User', password: 'User12345!', role: 'user', accessLevel: 'user' },
  { email: 'viewer@example.com', name: 'Viewer', password: 'Viewer12345!', role: 'user', accessLevel: 'viewer' },
];

async function main(): Promise<void> {
  const config = loadConfig();
  const db = openDatabase(config.databasePath);
  const auth = createAuth(db, config);

  try {
    const context = await auth.$context;
    await context.runMigrations();
    runMigrations(db, path.join(appRoot, 'migrations'));

    const internal = context.internalAdapter;
    const password = context.password;

    for (const seed of USERS) {
      const existing = db.prepare('SELECT id FROM user WHERE email = ?').get(seed.email) as
        | { id: string }
        | undefined;
      if (existing) {
        console.log(`= ${seed.email} already exists, skipping`);
        continue;
      }
      const userId = generateId(32);
      const hash = await password.hash(seed.password);
      await internal.createUser(
        {
          id: userId,
          email: seed.email,
          name: seed.name,
          emailVerified: true,
          role: seed.role,
        },
        'seed',
      );
      await internal.createAccount({
        id: generateId(32),
        userId,
        providerId: 'credential',
        accountId: userId,
        password: hash,
      });
      createProfile(db, userId, seed.accessLevel, config.defaultTimezone);
      db.prepare('INSERT OR IGNORE INTO app_team_members (team_id, user_id) VALUES (?, ?)').run('team-general', userId);
      console.log(`+ created ${seed.role}/${seed.accessLevel}: ${seed.email}`);
    }
    console.log('Seed complete.');
  } finally {
    closeDatabase(db);
  }
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});