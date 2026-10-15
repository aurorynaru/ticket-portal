import { loadConfig } from './config/env.js';
import { buildApp } from './app.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const ctx = await buildApp(config);

  await ctx.app.listen({ port: config.port, host: '0.0.0.0' });
  ctx.app.log.info(
    { schemaVersion: ctx.schemaVersion, database: config.databasePath },
    'server started',
  );

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    ctx.app.log.info({ signal }, 'shutting down');
    try {
      await ctx.close();
      // Set the exit code and let the event loop drain so stdout flushes;
      // process.exit() would drop buffered log writes.
      process.exitCode = 0;
    } catch (err) {
      ctx.app.log.error({ err }, 'shutdown failed');
      process.exitCode = 1;
    }
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});