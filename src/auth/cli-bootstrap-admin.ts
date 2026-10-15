import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { generateId } from '@better-auth/core/utils/id';
import { loadConfig, type AppConfig } from '../config/env.js';
import { openDatabase, closeDatabase } from '../db/connection.js';
import { runMigrations } from '../db/migrations.js';
import { createAuth } from './auth.js';
import { createProfile, getProfile, type AccessLevel } from './profiles.js';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Must match emailAndPassword.minPasswordLength in auth.ts.
const MIN_PASSWORD_LENGTH = 10;
const MAX_PASSWORD_LENGTH = 128;

export class BootstrapAdminError extends Error {}

export interface BootstrapAdminInput {
  email: string;
  password: string;
  name?: string;
}

export interface BootstrapAdminResult {
  userId: string;
  email: string;
  name: string;
  role: 'admin';
  accessLevel: AccessLevel;
}

/**
 * One-time first-admin bootstrap.
 *
 * - Targets the database configured by the process environment (in production
 *   loadConfig() enforces DATABASE_PATH under /data, so this always points at
 *   the persistent volume, never a local/E2E database).
 * - Creates the Better Auth user (role "admin"), the credential account, and
 *   the application profile (accessLevel "manager") in ONE transaction.
 * - Refuses to run when the email already exists. It never resets passwords,
 *   never changes roles, and never modifies any existing account.
 * - The password is only ever used to compute the hash; it is never logged.
 */
export async function bootstrapAdmin(
  config: AppConfig,
  input: BootstrapAdminInput,
): Promise<BootstrapAdminResult> {
  const email = input.email.trim().toLowerCase();
  const name = (input.name ?? 'Administrator').trim();
  if (!EMAIL_RE.test(email)) throw new BootstrapAdminError('Invalid email address');
  if (name.length < 1 || name.length > 200) throw new BootstrapAdminError('Invalid name');
  if (input.password.length < MIN_PASSWORD_LENGTH) {
    throw new BootstrapAdminError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }
  if (input.password.length > MAX_PASSWORD_LENGTH) {
    throw new BootstrapAdminError(`Password must be at most ${MAX_PASSWORD_LENGTH} characters`);
  }

  const db = openDatabase(config.databasePath);
  const auth = createAuth(db, config);
  try {
    // Same idempotent migrations the application runs at startup (docs/17).
    const context = await auth.$context;
    await context.runMigrations();
    runMigrations(db, path.join(appRoot, 'migrations'));

    const existing = db
      .prepare('SELECT id FROM user WHERE lower(email) = lower(?)')
      .get(email) as { id: string } | undefined;
    if (existing) {
      throw new BootstrapAdminError(
        `Account ${email} already exists. This command is one-time and never resets passwords or changes roles.`,
      );
    }

    const hash = await context.password.hash(input.password);
    const userId = generateId(32);

    db.exec('BEGIN IMMEDIATE');
    try {
      await context.internalAdapter.createUser(
        { id: userId, email, name, emailVerified: true, role: 'admin' },
        { method: 'admin' },
      );
      await context.internalAdapter.createAccount({
        id: generateId(32),
        userId,
        providerId: 'credential',
        accountId: userId,
        password: hash,
      });
      createProfile(db, userId, 'manager', config.defaultTimezone);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }

    const profile = getProfile(db, userId);
    if (!profile || profile.accessLevel !== 'manager' || !profile.isActive) {
      throw new BootstrapAdminError('Profile verification failed after creation');
    }
    return { userId, email, name, role: 'admin', accessLevel: 'manager' };
  } finally {
    closeDatabase(db);
  }
}

async function hiddenPrompt(question: string): Promise<string> {
  process.stdout.write(question);
  const stdin = process.stdin;
  if (!stdin.isTTY) {
    throw new BootstrapAdminError(
      'Interactive password entry requires a TTY. Set BOOTSTRAP_ADMIN_EMAIL and BOOTSTRAP_ADMIN_PASSWORD instead.',
    );
  }
  stdin.setRawMode(true);
  const chars: string[] = [];
  try {
    stdin.resume();
    for await (const data of stdin) {
      for (const ch of data.toString('utf8')) {
        if (ch === '\r' || ch === '\n') {
          process.stdout.write('\n');
          return chars.join('');
        }
        if (ch === '\u0003') {
          process.stdout.write('\n');
          process.exit(130);
        }
        if (ch === '\u007f' || ch === '\b') {
          if (chars.length > 0) {
            chars.pop();
            process.stdout.write('\b \b');
          }
          continue;
        }
        if (ch >= ' ') {
          chars.push(ch);
          process.stdout.write('*');
        }
      }
    }
  } finally {
    stdin.setRawMode(false);
    stdin.pause();
  }
  throw new BootstrapAdminError('Unexpected end of input');
}

async function readCredentials(): Promise<BootstrapAdminInput> {
  const envEmail = process.env.BOOTSTRAP_ADMIN_EMAIL;
  const envPassword = process.env.BOOTSTRAP_ADMIN_PASSWORD;
  if (envEmail && envPassword) {
    return { email: envEmail, password: envPassword, name: process.env.BOOTSTRAP_ADMIN_NAME };
  }
  if (process.stdin.isTTY && process.stdout.isTTY) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const ask = (q: string): Promise<string> => new Promise((resolve) => rl.question(q, resolve));
    const email = (await ask('Admin email: ')).trim();
    const name = (await ask('Admin name [Administrator]: ')).trim();
    rl.close();
    const password = await hiddenPrompt('Admin password (min 10 chars, hidden): ');
    return { email, password, name: name || undefined };
  }
  throw new BootstrapAdminError(
    'Missing credentials. Set BOOTSTRAP_ADMIN_EMAIL and BOOTSTRAP_ADMIN_PASSWORD, or run interactively in a TTY.',
  );
}

async function main(): Promise<void> {
  const config = loadConfig();
  console.log(`Target database: ${config.databasePath} (NODE_ENV=${config.nodeEnv})`);

  const input = await readCredentials();
  const result = await bootstrapAdmin(config, input);
  console.log('First admin created successfully.');
  console.log(`  email:        ${result.email}`);
  console.log(`  name:         ${result.name}`);
  console.log(`  user id:      ${result.userId}`);
  console.log(`  auth role:    ${result.role}`);
  console.log(`  access level: ${result.accessLevel}`);
  console.log('Sign in at the application login page. This command is one-time: it will refuse to run again for this email.');
}

const isDirectRun =
  typeof process.argv[1] === 'string' &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  main().catch((err) => {
    console.error(`Bootstrap failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}