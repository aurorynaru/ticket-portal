import { loadConfig } from '../config/env.js';
import { openDatabase } from '../db/connection.js';
import { createAuth } from './auth.js';

// Standalone entry for the official Better Auth CLI
// (e.g. `npx auth@1.7.7 migrate --config src/auth/cli-config.ts`).
// The CLI imports this module and uses the exported `auth` instance.
const config = loadConfig();
const db = openDatabase(config.databasePath);

export const auth = createAuth(db, config);