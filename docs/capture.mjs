#!/usr/bin/env node
/**
 * Captures the screenshots/GIFs in docs/images/ — how those assets are made.
 *
 * What it does: builds are assumed done (`pnpm build` first); the script boots
 * the built server (server/dist/index.js) with a throwaway DB, seeds a demo
 * stack through the real HTTP API, then drives headless Chromium:
 *
 *   - docs/images/stack.png         1280x800 screenshot of the stack view
 *   - docs/images/pop-ceremony.gif  ≤640px-wide GIF of the pop ceremony
 *                                   (Done → lift → crumple → burn → reveal)
 *
 * Needs: system ffmpeg on PATH (GIF assembly only — the PNG is pure
 * Playwright), and the Playwright Chromium binary (`pnpm --filter web exec
 * playwright install chromium`, once per machine).
 *
 * Run from the repo root with web's node_modules on the resolution path, so
 * @playwright/test resolves from the workspace, not the repo root:
 *
 *   pnpm --filter @task-stack/web exec node ../docs/capture.mjs
 *
 * The demo database lands in the OS temp dir and the server process is
 * stopped when the script exits (or crashes). Nothing in the repo is touched
 * except docs/images/.
 */

/* eslint-disable no-undef -- node globals (process, console, fetch, …) are
   only declared for the config's package-specific file patterns; this script
   lives in docs/ and opts out of that one rule. */
import { spawn, execFile } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileP = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** @playwright/test lives in web's node_modules — resolve from there. */
const requireFromWeb = createRequire(path.join(repoRoot, "web", "package.json"));
const { chromium } = requireFromWeb("@playwright/test");

const PORT = 4321;
const BASE = `http://127.0.0.1:${PORT}`;
const DEMO_NOTES = [
  "water the basil",
  "reply to Sam",
  "sand the chair legs",
  "fix the wobbly shelf",
  "return the library books",
  "sort the sock drawer",
];

const server = spawn(process.execPath, [path.join(repoRoot, "server", "dist", "index.js")], {
  cwd: repoRoot,
  env: {
    ...process.env,
    PORT: String(PORT),
    HOST: "127.0.0.1",
    DB_PATH: path.join(os.tmpdir(), `task-stack-capture-${process.pid}.db`),
  },
  stdio: "inherit",
});

async function waitForHealth() {
  for (let i = 0; i < 100; i++) {
    if (server.exitCode !== null) {
      throw new Error(`server exited early with code ${server.exitCode}`);
    }
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("server did not become healthy");
}

/** Seed the demo stack through the same API a real client uses. */
async function seed() {
  const res = await fetch(`${BASE}/api/stacks`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Weekend" }),
  });
  if (res.status !== 201) throw new Error(`stack create returned ${res.status}`);
  const state = await res.json();
  const stackId = state.activeStackId;
  for (const text of DEMO_NOTES) {
    const note = await fetch(`${BASE}/api/stacks/${stackId}/notes`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (note.status !== 201) throw new Error(`note push returned ${note.status}`);
  }
}

try {
  await waitForHealth();
  await seed();

  const imagesDir = path.join(repoRoot, "docs", "images");
  await mkdir(imagesDir, { recursive: true });

  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 2, // render at 2x, save at CSS size → crisp 1280x800 PNG
  });
  const page = await context.newPage();
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.getByText("sort the sock drawer").waitFor({ state: "visible" });
  await page.waitForTimeout(600); // let fonts settle

  // --- stack.png ------------------------------------------------------------
  const pngPath = path.join(imagesDir, "stack.png");
  await page.screenshot({ path: pngPath, scale: "css" });
  console.log(`wrote ${pngPath}`);

  // --- pop-ceremony.gif -----------------------------------------------------
  // CDP screencast while clicking Done: lift → crumple → burn → reveal.
  const cdp = await context.newCDPSession(page);
  const frames = [];
  cdp.on("Page.screencastFrame", async (ev) => {
    frames.push({ ts: ev.metadata.timestamp, data: ev.data });
    await cdp.send("Page.screencastFrameAck", { sessionId: ev.sessionId }).catch(() => {});
  });
  await cdp.send("Page.startScreencast", {
    format: "jpeg",
    quality: 85,
    maxWidth: 640,
    maxHeight: 400,
    everyNthFrame: 1,
  });
  await page.getByRole("button", { name: "Done" }).click();
  await page.waitForTimeout(3000); // ceremony ≈1.6s + reveal + margin
  await cdp.send("Page.stopScreencast");

  if (frames.length < 5) {
    console.log("too few screencast frames — skipping GIF, PNG only");
  } else {
    // Keep the frames from just before the click to +3s, write them out.
    const t0 = frames[0].ts;
    const kept = frames.filter((f) => f.ts - t0 <= 3.2);
    const framesDir = path.join(os.tmpdir(), `task-stack-frames-${process.pid}`);
    await rm(framesDir, { recursive: true, force: true });
    await mkdir(framesDir);
    for (let i = 0; i < kept.length; i++) {
      await writeFile(
        path.join(framesDir, `${String(i + 1).padStart(4, "0")}.jpg`),
        Buffer.from(kept[i].data, "base64"),
      );
    }
    // Rough fps from the real timestamps, clamped to a sane GIF band.
    const span = kept[kept.length - 1].ts - kept[0].ts;
    const fps = Math.min(15, Math.max(8, Math.round((kept.length - 1) / span)));
    const gifPath = path.join(imagesDir, "pop-ceremony.gif");
    await execFileP("ffmpeg", [
      "-y",
      "-framerate",
      String(fps),
      "-i",
      path.join(framesDir, "%04d.jpg"),
      "-vf",
      "scale=640:-2:flags=lanczos,split[a][b];[a]palettegen=max_colors=128[p];[b][p]paletteuse=dither=bayer",
      "-loop",
      "0",
      gifPath,
    ]);
    await rm(framesDir, { recursive: true, force: true });
    console.log(`wrote ${gifPath} (${kept.length} frames @ ${fps}fps)`);
  }

  await browser.close();
} finally {
  server.kill("SIGTERM");
}
