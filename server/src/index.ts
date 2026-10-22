import { buildApp } from "./app.js";
import { dbPathFromEnv, openDatabase } from "./db.js";

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "127.0.0.1";

const app = await buildApp({ logger: true });

const dbPath = dbPathFromEnv(); // DB_PATH env wins, else module-relative server/data.db
const db = openDatabase(dbPath);

// Graceful shutdown — finish in-flight requests before exiting (Docker sends
// SIGTERM on stop/restart; see T36/T37). app.close() runs first, then
// db.close() (cleanly checkpoints the WAL so the volume backup is a single
// consistent file), in both the success and rejection paths of app.close().
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void app.close().finally(() => {
      try {
        db.close();
      } catch (err) {
        app.log.error(err);
      }
      process.exit(0);
    });
  });
}

try {
  await app.listen({ port, host });
  // Log where data actually lives so operators can find it for backups (T37).
  app.log.info({ db: dbPath }, "SQLite database ready");
} catch (err) {
  app.log.error(err);
  try {
    db.close();
  } finally {
    process.exit(1);
  }
}
