import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  retries: 0,
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:3111',
  },
  webServer: {
    // Wipe the ephemeral test DB (the suite is not idempotent against a
    // populated one), build, seed synthetic users, then serve.
    command:
      "node -e \"require('fs').rmSync('.local/e2e',{recursive:true,force:true})\" && npm run build && npm run seed:e2e && node dist/server.js",
    url: 'http://127.0.0.1:3111/health/live',
    env: {
      NODE_ENV: 'test',
      PORT: '3111',
      DATABASE_PATH: './.local/e2e/tickets.db',
      UPLOAD_DIR: './.local/e2e/uploads',
      LOG_LEVEL: 'silent',
      BETTER_AUTH_URL: 'http://127.0.0.1:3111',
      BETTER_AUTH_SECRET: 'e2e-test-secret-0123456789abcdef0123456789',
      SESSION_TRUSTED_ORIGIN: 'http://127.0.0.1:3111',
    },
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});