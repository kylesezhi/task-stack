/**
 * Playwright e2e harness (T17; sources: TASKS.md T17 Done-when, the boot
 * pattern of web/src/lib/state-client.smoke.test.ts). T22 extends this into
 * the full suite — keep it minimal; no custom fixtures yet.
 *
 * Hermeticity rationale: every run gets
 * - a FRESH SQLite DB (mkdtemp temp dir; never touches server/data.db), so
 *   runs start on a true first-run server and cannot leak state into each
 *   other (spec precondition: the First Run form is the first screen);
 * - two probed free ports (bind port 0 on loopback, read, close — same as
 *   the smoke test) for the API server and Vite, with `reuseExistingServer:
 *   false`, so this never talks to (or races with) a dev server already
 *   running under `mise run server` / `mise run web`;
 * - a Vite pointed at ITS OWN throwaway API server via the e2e-only
 *   API_PROXY_TARGET override (web/vite.config.ts), not the 127.0.0.1:3000
 *   dev default.
 *
 * Why the run env is FILE-BACKED (TASK_STACK_E2E_ENV_FILE): Playwright
 * evaluates this config once in the launcher AND AGAIN in the child process
 * that runs the tests (it re-imports the config to resolve fixtures). Naive
 * module-scope probing evaluated twice and produced two different port sets
 * in one run: webServers bound the launcher's pair, `use.baseURL` came from
 * the second eval's pair, and page.goto connected to nothing. The launcher's
 * eval memoizes its resolved env into a JSON file under the work dir and
 * points the env var at it; every re-import reads the same file, so all
 * processes in a run agree on the ports and the work dir. Absolute paths
 * resolve from THIS file too, never process.cwd() — the config must be
 * runnable from any directory.
 */
import { defineConfig } from "@playwright/test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** The shared per-run environment, resolved once and memoized to disk. */
interface E2eEnv {
  /** mkdtemp dir holding the DB (and the env memo before it is replaced). */
  workDir: string;
  apiPort: number;
  webPort: number;
}

/**
 * Probes a free TCP port: binds port 0 on loopback, reads the assigned port,
 * then closes. The OS will not reassign it between here and the servers'
 * listens in practice (and a collision would fail the health poll loudly).
 */
function probeFreePort(): Promise<number> {
  return new Promise((resolve_, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      if (address === null || typeof address === "string") {
        reject(new Error("probe listen gave no TCP port"));
        return;
      }
      resolve_(address.port);
      probe.close();
    });
  });
}

const webDir = join(import.meta.dirname); // <repo>/web
const serverDir = join(import.meta.dirname, "..", "server"); // <repo>/server

/**
 * Resolves the run environment: from the memoized file if one is already
 * pointed at (every process after the launcher inherits the env var), or by
 * creating one (mkdtemp work dir + two probed ports) when this IS the
 * launcher's eval.
 *
 * Only the launcher branch registers cleanup: a process-level "exit"
 * handler that rmSyncs the work dir. Playwright's globalTeardown does not
 * exist as a task when a webServer fails to boot (the task list breaks
 * before it) and never runs in `--list`/UI mode, so rmSync-per-file alone
 * leaks the mkdtemp; the exit handler covers those paths. Known
 * limitations (accepted): exit handlers are skipped on hard signals
 * (SIGKILL) and by some default-termination paths on SIGINT — strictly
 * better than the status quo, not bulletproof. rmSync is idempotent with
 * `force: true`, so it coexists with globalTeardown's identical rm.
 */
async function resolveE2eEnv(): Promise<E2eEnv> {
  const memoFile = process.env["TASK_STACK_E2E_ENV_FILE"];
  if (memoFile !== undefined) {
    return JSON.parse(readFileSync(memoFile, "utf8")) as E2eEnv;
  }
  const workDir = mkdtempSync(join(tmpdir(), "task-stack-e2e-"));
  // Trust: workDir comes from our own mkdtempSync here (unlike teardown's
  // re-read env var, which is validated before deletion).
  process.on("exit", () => rmSync(workDir, { recursive: true, force: true }));

  const apiPort = await probeFreePort();
  // probeFreePort closes its socket before the next probe, so the OS may
  // hand the SAME port back — a second probe can collide with the API's.
  // Bounded retry loop; a persistent collision fails loudly instead of
  // pointing API and Vite at one port.
  const MAX_PORT_COLLISION_RETRIES = 10;
  let webPort = await probeFreePort();
  for (let attempt = 1; webPort === apiPort; attempt += 1) {
    if (attempt > MAX_PORT_COLLISION_RETRIES) {
      throw new Error(
        `probeFreePort returned port ${apiPort} for both servers after ${MAX_PORT_COLLISION_RETRIES} retries`,
      );
    }
    webPort = await probeFreePort();
  }

  const env: E2eEnv = {
    workDir,
    apiPort,
    webPort,
  };
  // The memo lives under the work dir it describes. Written BEFORE the env
  // var is set: a later eval may only ever see a complete file.
  const memoPath = join(workDir, "env.json");
  writeFileSync(memoPath, JSON.stringify(env));
  process.env["TASK_STACK_E2E_ENV_FILE"] = memoPath;
  process.env["TASK_STACK_E2E_WORK_DIR"] = workDir; // (teardown reads this)
  return env;
}

const e2e = await resolveE2eEnv();
const dbPath = join(e2e.workDir, "data.db");
const apiURL = `http://127.0.0.1:${e2e.apiPort}`;
const webURL = `http://127.0.0.1:${e2e.webPort}`;

export default defineConfig({
  testDir: "./tests/e2e",
  // The specs share this run's ONE DB (head comment), so exactly one worker:
  // Playwright distributes spec FILES across workers, and a second spec file
  // under default parallelism would race on this DB. Per-worker DBs would be
  // the way to lift the pin later, if ever needed.
  workers: 1,
  // Playwright's globalTeardown is a file path, not a closure. Ordering
  // truth: teardown tasks run LIFO and the webServer plugin tasks are
  // registered FIRST, so globalTeardown runs while both servers (and the
  // SQLite handle) are still alive — but rmSync on Linux unlinking an open
  // file succeeds (the entry vanishes, handles stay valid until close), and
  // this project targets Linux only (mise / Docker), so cleanup is safe.
  // The config's own process "exit" handler does the same rm idempotently.
  globalTeardown: "./tests/teardown.ts",
  webServer: [
    {
      // The real Fastify server (node + tsx, T10), exactly as the smoke test
      // boots it. Roomy timeout: tsx cold start dominates the boot.
      command: "node --import tsx src/index.ts",
      cwd: serverDir,
      url: `${apiURL}/api/health`,
      timeout: 120_000,
      reuseExistingServer: false,
      env: {
        HOST: "127.0.0.1",
        PORT: String(e2e.apiPort),
        DB_PATH: dbPath,
      },
    },
    {
      // Vite dev server, proxied to the throwaway API above (API_PROXY_TARGET,
      // web/vite.config.ts). --host 127.0.0.1: Vite's default "localhost"
      // binds [::1] only, and Playwright's url probe uses IPv4 — without the
      // explicit host the readiness probe connects to nothing.
      command: `pnpm exec vite --host 127.0.0.1 --port ${e2e.webPort} --strictPort`,
      cwd: webDir,
      url: webURL,
      timeout: 120_000,
      reuseExistingServer: false,
      env: {
        API_PROXY_TARGET: apiURL,
      },
    },
  ],
  use: {
    baseURL: webURL,
  },
});
