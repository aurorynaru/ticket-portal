import { spawn } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = process.env.PORT ?? '3111';
const dataDir = path.join(root, '.local', 'e2e-tarmy');

// Fresh, deterministic test database for every run (test artifact only, never production data).
rmSync(dataDir, { recursive: true, force: true });
mkdirSync(path.join(dataDir, 'uploads'), { recursive: true });

const env = {
  ...process.env,
  NODE_ENV: 'test',
  PORT: port,
  DATABASE_PATH: path.join(dataDir, 'tickets.db'),
  UPLOAD_DIR: path.join(dataDir, 'uploads'),
  LOG_LEVEL: 'silent',
  BETTER_AUTH_URL: `http://127.0.0.1:${port}`,
  BETTER_AUTH_SECRET: 'e2e-test-secret-0123456789abcdef0123456789',
  SESSION_TRUSTED_ORIGIN: `http://127.0.0.1:${port}`,
};

function run(cmd, args) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd: root, env, stdio: 'inherit' });
    child.on('error', () => resolve(1));
    child.on('close', (code) => resolve(code ?? 1));
  });
}

const tsxCli = path.join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const seedCode = await run(process.execPath, [tsxCli, 'scripts/seed-e2e.ts']);
if (seedCode !== 0) process.exit(seedCode);

const server = spawn(process.execPath, ['dist/server.js'], { cwd: root, env, stdio: 'inherit' });
server.on('error', () => process.exit(1));
server.on('close', (code) => process.exit(code ?? 0));
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    server.kill(sig);
  });
}