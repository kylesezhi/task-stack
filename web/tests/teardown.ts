/**
 * Playwright global teardown (T17) — removes the per-run mkdtemp work dir
 * (fresh DB per run; see playwright.config.ts). Playwright's globalTeardown
 * is a file path, not a closure, so the work dir is passed through
 * TASK_STACK_E2E_WORK_DIR (set at config-eval time).
 *
 * Ordering truth: teardown tasks run LIFO and Playwright registers the
 * webServer plugin tasks FIRST, so this runs while both servers (and the
 * SQLite handle) are still alive. That is safe anyway on Linux — rmSync
 * unlinks the directory entries and open file handles stay valid until
 * their owners close — and this project targets Linux only (mise/Docker).
 */
import { existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

/**
 * Only our own mkdtemp dirs may be deleted: the resolved path must sit under
 * `<tmpdir>/task-stack-e2e-` (parent by construction in the config). Anything
 * else throws loudly so a stray env var can never rm an arbitrary directory.
 */
function resolveWorkDir(): string {
  const workDir = process.env["TASK_STACK_E2E_WORK_DIR"];
  // Loud on a missing env: it would mean the config didn't evaluate first.
  if (typeof workDir !== "string" || workDir.length === 0) {
    throw new Error("globalTeardown: TASK_STACK_E2E_WORK_DIR is not set");
  }
  const allowedRoot = join(tmpdir(), "task-stack-e2e-");
  if (!resolve(workDir).startsWith(allowedRoot)) {
    throw new Error(`globalTeardown: refusing to delete ${workDir} — not under ${allowedRoot}`);
  }
  return workDir;
}

export default async function globalTeardown(): Promise<void> {
  const workDir = resolveWorkDir();
  if (existsSync(workDir)) {
    rmSync(workDir, { recursive: true, force: true });
  }
}
