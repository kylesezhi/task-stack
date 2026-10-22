import { fastify, type FastifyInstance } from "fastify";

export interface BuildAppOptions {
  /** Pino logging on/off. Off by default so tests and CI stay quiet. */
  logger?: boolean;
}

/**
 * App factory. All routes/plugins register here so tests (T06+) can call
 * `buildApp()` and use `app.inject()` without touching the network. The
 * listening process lives in `index.ts`.
 */
export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const app = fastify({ logger: options.logger ?? false });

  app.get("/api/health", async () => ({ ok: true }));

  return app;
}
