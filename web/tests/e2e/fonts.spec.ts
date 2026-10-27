/**
 * T24 self-hosted fonts e2e (sources: TASKS.md T24, DECISIONS.md §8).
 *
 * The T24 Done-when has two halves, and this spec automates both — one
 * test, both asserted:
 *
 * (a) ZERO EXTERNAL FONT REQUESTS. The request listener is attached BEFORE
 *     navigation so nothing (early main.ts, the CSS import chain, the
 *     @font-face fetches) can slip past uncounted. Every collected URL must
 *     share the page's origin — spec'd as origin equality rather than a
 *     fonts-hostname blocklist, so ANY third-party sneak-in (analytics,
 *     CDN, whatever lands later) fails this test too. DECISIONS.md §8:
 *     Caveat+Inter are self-hosted OFL, "bundled files, no CDN".
 *
 * (b) THE LOCAL FILES ACTUALLY RESOLVE AND REGISTER. Specs share ONE DB and
 *     run alphabetically; at this spec's turn the DB holds one stack
 *     ("Work", created by first-run.spec.ts) with ZERO pending notes —
 *     nothing on screen renders Caveat handwriting, so visibility would
 *     wait forever. Instead document.fonts.load() forces both @font-face
 *     rules to fetch regardless of what's rendered. Failure semantics
 *     (both caught below): a MISSING matching face (typo'd family, missing
 *     rule) resolves to an empty array, while a broken/404 fetch or a
 *     parse failure of a matched face REJECTS the load() promise.
 *
 * No hex/color assertions: the guard for "tokens are the only color source"
 * is the unit test (web/src/tokens.test.ts); this spec is the network-panel
 * half of T24.
 */
import { expect, test } from "@playwright/test";

test("fonts are self-hosted: no external requests, both faces load from /fonts", async ({
  page,
}) => {
  // -- Collect BEFORE goto: the earliest requests count too ----------------
  const requestURLs: string[] = [];
  page.on("request", (request) => requestURLs.push(request.url()));
  const failedURLs: string[] = [];
  page.on("requestfailed", (request) => failedURLs.push(request.url()));

  await page.goto("/");
  // Force BOTH @font-face fetches regardless of the on-screen view: at this
  // spec's runtime the run DB holds one stack ("Work", alphabetically after
  // first-run.spec.ts) with ZERO notes, so no Caveat handwriting is on
  // screen anywhere — waiting for visible handwritten text would wait
  // forever. document.fonts.load() fetches the faces without any rendering.
  const loaded = await page.evaluate(() =>
    Promise.all([document.fonts.load("600 29px Caveat"), document.fonts.load("500 14px Inter")]),
  );

  // (a) Same-origin only — catches any CDN/Google Fonts request, not just
  // fonts; the page origin is stable after a single goto("/").
  const pageOrigin = new URL(page.url()).origin;
  const external = requestURLs.filter((url) => new URL(url).origin !== pageOrigin);
  expect(external, "every request must share the page's origin (no CDN)").toEqual([]);

  // (b) At least the two @font-face files were requested, over the local
  // origin, and no TRANSPORT-level font fetch failure was observed.
  const woff2 = requestURLs.filter((url) => url.endsWith(".woff2"));
  expect(woff2.length).toBeGreaterThanOrEqual(2);
  for (const url of woff2) {
    expect(new URL(url).origin).toBe(pageOrigin);
  }
  // requestfailed covers transport-level failures only — an HTTP 404 for a
  // woff2 is a RESPONSE, not a requestfailed event. 404s/parse failures are
  // instead caught by the load() assertions below (each REJECTS on a failed
  // per-face load); this net adds the DNS/socket-level cases on top.
  expect(
    failedURLs.filter((url) => url.endsWith(".woff2")),
    "no .woff2 fetch may fail",
  ).toEqual([]);

  // document.fonts.load resolves with the faces that matched AND loaded; it
  // rejects if any per-face load fails (broken/404 URL, parse error), and a
  // typo'd family name / missing rule matches nothing and resolves []. The
  // two assertions catch the mismatch case; the rejection paths would fail
  // the test itself (page.evaluate rejects).
  expect(loaded[0].length).toBeGreaterThan(0);
  expect(loaded[1].length).toBeGreaterThan(0);
});
