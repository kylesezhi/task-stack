// Hermetic test-suite setup (runs before every test file, via
// vitest.config.ts's test.setupFiles).
//
// WEB_DIST_PATH is deleted so an OPERATOR's ambient env value can never leak
// into the suite: several test files build plain API-only apps with
// `buildApp({ db })` and no webDist option, and app.ts throws on a
// configured-but-missing WEB_DIST_PATH — one exported shell variable would
// poison every test file at once. static.test.ts's nested "WEB_DIST_PATH env"
// describe sets and restores the variable per-test itself, so clearing it
// here just establishes the undefined baseline that describe restores to.
//
// DB_PATH is deliberately untouched: no test reads it (openDatabase always
// gets explicit file paths, dbPathFromEnv is index.ts-only), so there is
// nothing ambient to leak — and untracked deletions of unrelated env keys
// would just mask a future test that forgets to inject its inputs.
delete process.env.WEB_DIST_PATH;
