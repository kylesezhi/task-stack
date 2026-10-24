import { buildApp } from "./app.js";
import { dbPathFromEnv, openDatabase } from "./db.js";
import type { FastifyInstance } from "fastify";

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "127.0.0.1";

const dbPath = dbPathFromEnv(); // DB_PATH env wins, else module-relative server/data.db
const db = openDatabase(dbPath);

let app: FastifyInstance | undefined;
try {
  app = await buildApp({ db, logger: true });

  // Graceful shutdown — finish in-flight requests before exiting (Docker sends
  // SIGTERM on stop/restart; see T36/T37). app.close() runs first, then
  // db.close() (cleanly checkpoints the WAL so the volume backup is a single
  // consistent file), in both the success and rejection paths of app.close().
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      void app!.close().finally(() => {
        try {
          db.close();
        } catch (err) {
          app!.log.error(err);
        }
        process.exit(0);
      });
    });
  }

  await app.listen({ port, host });
  // Log where data actually lives so operators can find it for backups (T37).
  app.log.info({ db: dbPath }, "SQLite database ready");
} catch (err) {
  // app can be undefined when buildApp itself failed (startup
  // misconfiguration — e.g. app.ts's loud web-dist failure): a pino logger
  // lives on the app instance, so until it exists console.error is the only
  // channel. Either way the db handle is closed — an open SQLite handle must
  // never leak past an exiting process — and the exit is loud (1), matching
  // the listen-failure path.
  if (app === undefined) {
    console.error(err);
  } else {
    app.log.error(err);
  }
  try {
    db.close();
  } finally {
    process.exit(1);
  }
}
