# task-stack — deploy runbook

Manual deployment to the owner's Ubuntu VM (T36). One container, built on the
VM, reached by `git clone` + `docker compose up -d`. Every command is
copy-pasteable on Ubuntu 22.04/24.04 with Docker Engine and the `docker
compose` CLI plugin. One caveat before the confidence: the image build has
never been executed against a real Docker daemon (T35 caveat in `TASKS.md`) —
§3 step 4 and §9 expand on that.

## 1. what this is

A single-user app with **no auth**: anyone who can reach the URL can edit the
stacks (accepted risk, `DECISIONS.md` §9). One container serving one process
against SQLite on a host bind mount. The whole deployment assumes a machine
with no public address: don't publicize the URL, don't port-forward it, and
check §2's interface line — a public address on this box means this app is
exposed with no auth.

## 2. pre-flight checks

Read-only; run the block and compare against the comments. A non-default
`HOST_PORT` belongs in `.env` (§3 step 3) — **not only in the shell**: compose
prefers the shell environment over `.env`, so an exported `HOST_PORT=9000`
would bind 9000 while every later block derives the port from `.env` and
curls 8181.

```sh
HOST_PORT="${HOST_PORT:-8181}"   # same default as .env.example / docker-compose.yml — a non-default value belongs in .env, not just here
docker --version                 # e.g. "Docker version 27.3.1, build ..." — any recent version works
docker compose version           # "Docker Compose version v2.2x" — if a later step rejects the file with `unknown field "name"`, delete that line (§9)
systemctl is-enabled docker      # "enabled" — anything else breaks the reboot test; fix: sudo systemctl enable docker
uname -m                         # e.g. "x86_64" — the image is built for whatever this says, which is why there is no docker save/load step
ip -4 addr show scope global     # every address this app (bound 0.0.0.0) is reachable on — if any is a public address, the box is on the internet and the app has no auth
ss -ltnp | grep -w "$HOST_PORT"  # no output — the owner's VM already runs 80, 1200, 1883, 3000, 3100, 3101, 4242, 8000, 8001, 8080, 8095, 8123, 9090, 19132, 25565 (several currently DOWN — still avoided)
docker info --format '{{.ServerVersion}}'  # the daemon version, e.g. "27.x" — an error means no daemon access
df -h "$HOME" /var/lib/docker    # a couple of GB free on both — the repo/build context lives under $HOME; the image and build cache live under /var/lib/docker
```

The user running these needs permission to talk to the docker daemon — either
in the `docker` group or with a `sudo` prefix. Pick one and use it for every
`docker` command below; the blocks are written without `sudo`. Either way
changes nothing about where the database lands: the compose file uses the
*relative* `./data`, which resolves against the directory holding
`docker-compose.yml`, not against `$HOME` — exactly why the file does not use
`${HOME}`.

One network fact worth knowing before the first `up`: `BIND_ADDR=0.0.0.0`
(the default) publishes on every interface, and Docker's DNAT rules bypass
ufw's `INPUT` filtering by default (`DOCKER-USER` is the hook), so
`ufw deny "$HOST_PORT"` alone will not stop the app. The lockdown path is
`BIND_ADDR=127.0.0.1` plus a reverse proxy.

## 3. first deploy

Every `sh` block in this runbook that talks to the app carries the same
four-line standing header — cd into the app dir, `set -euo pipefail`, derive
`PORT` and `BASE` from `.env` — so any block can be pasted into a fresh
terminal without inheriting an earlier block's shell state. The header's `cd`
deliberately exits the block rather than continuing in the wrong directory —
in an interactive shell `set -e` alone would not stop it, and a wrong-directory
run would curl whatever answers on the fallback port. One shell
assumption: the header leans on `set -euo pipefail`, which is bash — run the
blocks in bash (Ubuntu's default login shell); `sh script.sh` or dash fails
on `pipefail`. And if you paste a block into a script file, `set -e` makes a
non-empty `diff` in §4 exit the script before the cleanup block — if the
diff reports anything, run the cleanup block separately.

1. Clone:

   ```sh
   APP_DIR="$HOME/task-stack"
   REPO_URL=""   # ← put your clone URL here; the placeholder exists because the origin URL must not appear in repo docs (DECISIONS.md §9)
   git clone "$REPO_URL" "$APP_DIR" && cd "$APP_DIR"
   ```

2. Pre-create the data directory with the right owner — **do not skip this**:

   ```sh
   cd "$HOME/task-stack" || { echo "no app directory at $HOME/task-stack — cd to the deploy checkout first"; exit 1; }
   mkdir -p data
   sudo chown 1000:1000 data
   ls -ldn data    # owner/group must both read 1000
   ```

   1000 is the image's `node` user (uid 1000 in official node images).
   Skipped, docker auto-creates `./data` as root-owned, SQLite can't write,
   and the container crash-loops (symptom in §9, first row).

3. Environment, then the addressing variables every later block re-derives
   for itself:

   ```sh
   cd "$HOME/task-stack" || { echo "no app directory at $HOME/task-stack — cd to the deploy checkout first"; exit 1; }
   cp -n .env.example .env   # -n: never clobbers an .env you already edited
   set -euo pipefail         # the standing header's guard (see above)
   PORT="$(grep -E '^HOST_PORT=' .env | cut -d= -f2 || true)"
   PORT="${PORT:-8181}"
   BASE="http://127.0.0.1:$PORT"
   echo "$BASE"              # every URL below uses this
   ```

4. Build:

   ```sh
   cd "$HOME/task-stack" || { echo "no app directory at $HOME/task-stack — cd to the deploy checkout first"; exit 1; }
   docker compose build
   ```

   The first build pulls `node:24.22.1-alpine` and installs the workspace
   from `pnpm-lock.yaml`; a few minutes on a small VM, one-time. Honesty
   note, stated here because this is where it bites: this build has never
   been run against a real daemon (T35 caveat in `TASKS.md`) — this step is
   the real test of the `Dockerfile`. If it fails opaquely, re-run
   `docker build --progress=plain -t task-stack:latest .` for a legible
   error (§9).

5. Start:

   ```sh
   cd "$HOME/task-stack" || { echo "no app directory at $HOME/task-stack — cd to the deploy checkout first"; exit 1; }
   docker compose up -d
   ```

6. Verify — "starting" is normal at first: the healthcheck's first probe
   fires at `interval` (30s), so wait for the flip:

   ```sh
   cd "$HOME/task-stack" || { echo "no app directory at $HOME/task-stack — cd to the deploy checkout first"; exit 1; }
   set -euo pipefail
   PORT="$(grep -E '^HOST_PORT=' .env | cut -d= -f2 || true)"; PORT="${PORT:-8181}"
   BASE="http://127.0.0.1:$PORT"
   status=""
   for i in $(seq 1 12); do
     status="$(docker inspect --format '{{.State.Health.Status}}' task-stack)"
     [ "$status" = "healthy" ] && break
     sleep 5
   done
   [ "$status" = healthy ] || { echo "healthcheck never flipped (status=$status) — check docker compose logs before continuing"; exit 1; }
   echo "$status"                                   # healthy
   docker compose ps                                # "running (healthy)"
   docker inspect --format '{{.Image}}' task-stack  # the image id just built
   curl -fsS "$BASE/api/health"                     # {"ok":true}
   curl -sS -o /dev/null -w '%{http_code}\n' "$BASE/"    # 200
   curl -sSI "$BASE/api/health" | grep -i x-robots-tag   # x-robots-tag: noindex (DECISIONS.md §9)
   ls -l data/                                      # data.db (+ -wal/-shm while running) appeared
   ```

7. Verify from another machine. A curl pass does **not** prove the
   WebSocket path — the app's core sync is `/api/ws` (T12,
   `DECISIONS.md` §9):

   ```sh
   cd "$HOME/task-stack" || { echo "no app directory at $HOME/task-stack — cd to the deploy checkout first"; exit 1; }
   set -euo pipefail
   PORT="$(grep -E '^HOST_PORT=' .env | cut -d= -f2 || true)"; PORT="${PORT:-8181}"
   BASE="http://127.0.0.1:$PORT"
   echo "http://$(hostname -I | tr ' ' '\n' | grep -Ev '^172\.(1[6-9]|2[0-9]|3[01])\.' | head -n 1):$PORT/"   # LAN URL to open — Docker's 172.16/12 bridge addresses are filtered out; if it still looks wrong, pick the non-docker0/br-* address from §2's `ip -4 addr show scope global`; unreachable from other devices if BIND_ADDR=127.0.0.1
   ```

   Paste that URL into a browser on a phone or laptop on the same LAN
   (`<port>` is `HOST_PORT` from `.env`, default 8181). `hostname -I` can list
   Docker's bridge addresses (`172.17.0.1`, `br-*`) on a host like this one —
   they are not LAN-reachable, which is why they are filtered; if in doubt,
   take the LAN address from §2's interface line. Then, in two browser
   contexts (two windows or two devices), push a note in one and confirm it
   lands in the other — that is the WebSocket path working. REST checks alone
   say nothing about it.

## 4. reboot survival (the acceptance test)

Two tests, complementary. The primary one is **read-only**: snapshot
`/api/state` before and after the reboot and diff them — no writes, nothing
it can damage, and it proves the *whole database* survived, not one note. The
other pushes a canary note — required on a first deploy, optional
re-confirmation once the instance holds data (why: next paragraph) — and is
the only step that exercises the write path and WAL durability across a real
restart.

**Why a first deploy needs the canary:** a diff can only detect data
loss if the before-snapshot has content — against a fresh, empty instance the
server recreates an empty schema after reboot and returns a byte-identical
payload, so the diff passes while durability is completely broken. So: **on a
first deploy, run the canary block** (it is also what makes the diff
meaningful, since the snapshot then contains it). Once the instance holds
real data, the read-only diff is the primary test and the canary becomes
optional re-confirmation — the guard below refuses to proceed on a
contentless snapshot either way.

Canary — required on a first deploy, optional re-confirmation once the
instance holds data — pushed **first**, so the snapshot below already contains
it. Each block below carries the standing header itself (§3), so a fresh
terminal is fine at any point. The note is matched by its text afterwards,
never by id: notes in `/api/state` are drawer-ordered
(`server/src/state.ts` orders by stack position, then note position), so
extracting a note id positionally grabs whatever happens to sort first — on
a populated DB that is someone's real note:

```sh
cd "$HOME/task-stack" || { echo "no app directory at $HOME/task-stack — cd to the deploy checkout first"; exit 1; }
set -euo pipefail
PORT="$(grep -E '^HOST_PORT=' .env | cut -d= -f2 || true)"; PORT="${PORT:-8181}"
BASE="http://127.0.0.1:$PORT"
PREV="$(curl -fsS "$BASE/api/state" | sed -n 's/.*"activeStackId":"\([^"]*\)".*/\1/p')"
# PREV empty = activeStackId was null (fresh empty instance); the restore step below skips itself
CANARY="reboot-canary-$(date +%s)"
# One request for the create: the 201 body already IS the fresh snapshot
# (server/src/stacks.ts returns getAppState with the new stack active), so the
# canary stack id comes from the same response as the status code. A second
# /api/state read is deliberately not used: it would widen the window where
# another client (§3 step 7 opens a second browser context) switches the
# active stack — the re-read would then hand back someone else's stack id —
# and a failed re-read would abort with the canary stack already created and
# no cleanup handle written.
code="$(curl -sS -o "$HOME/task-stack-create.json" -w '%{http_code}' -X POST "$BASE/api/stacks" \
  -H 'content-type: application/json' -d '{"name":"reboot test"}')"
[ "$code" = "201" ] || { echo "stack create returned $code — aborting"; rm -f "$HOME/task-stack-create.json"; exit 1; }
STACK="$(sed -n 's/.*"activeStackId":"\([^"]*\)".*/\1/p' "$HOME/task-stack-create.json")"
[ -n "$STACK" ] || { echo "could not read the canary stack id from the 201 body — response kept at ~/task-stack-create.json; remove 'reboot test' in the UI"; exit 1; }
rm -f "$HOME/task-stack-create.json"
# Persist the cleanup handles now: from here on the canary stack exists and is
# active, so every failure path below must be able to undo it.
printf '%s %s %s\n' "$CANARY" "$STACK" "$PREV" > "$HOME/task-stack-canary.txt"
code="$(curl -sS -o /dev/null -w '%{http_code}' -X POST "$BASE/api/stacks/$STACK/notes" \
  -H 'content-type: application/json' -d "{\"text\":\"$CANARY\"}")"
if [ "$code" = "201" ]; then
  cat "$HOME/task-stack-canary.txt"   # shell variables die with the reboot; the file doesn't
else
  echo "note push returned $code — undoing the canary stack"
  code="$(curl -sS -o /dev/null -w '%{http_code}' -X DELETE "$BASE/api/stacks/$STACK")"
  [ "$code" = "200" ] || echo "stray-stack delete returned $code — remove 'reboot test' in the UI"
  if [ -n "$PREV" ]; then
    code="$(curl -sS -o /dev/null -w '%{http_code}' -X PUT "$BASE/api/active" \
      -H 'content-type: application/json' -d "{\"stackId\":\"$PREV\"}")"
    [ "$code" = "200" ] || echo "active-restore returned $code — set it in the UI instead"
  fi
  rm -f "$HOME/task-stack-canary.txt"
  exit 1
fi
```

Creating the canary stack makes it active (server behaviour, T10); the
cleanup below restores what was active before.

Primary test — the before-snapshot (everything must look identical after).
Written via a temp file + `mv` so a failed request leaves no junk baseline
behind:

```sh
cd "$HOME/task-stack" || { echo "no app directory at $HOME/task-stack — cd to the deploy checkout first"; exit 1; }
set -euo pipefail
PORT="$(grep -E '^HOST_PORT=' .env | cut -d= -f2 || true)"; PORT="${PORT:-8181}"
BASE="http://127.0.0.1:$PORT"
curl -fsS -o "$HOME/task-stack-state-before.json.tmp" "$BASE/api/state" \
  && mv "$HOME/task-stack-state-before.json.tmp" "$HOME/task-stack-state-before.json"
test -s "$HOME/task-stack-state-before.json"
# Content guard, not just bytes: on an empty database a lost DB and a kept DB
# both diff clean, so the snapshot must actually hold stacks before this test
# can prove anything (that is why the canary is required on a first deploy).
grep -q '"stacks":\[{' "$HOME/task-stack-state-before.json" \
  || { echo "database holds no stacks — this diff cannot fail; run the canary block above before rebooting"; exit 1; }
```

**Do not touch the app between the two snapshots.** Someone using it during
the reboot window changes completed-note ordering (completed_at-driven), and
the diff would legitimately differ. If the diff shows anything you cannot
attribute to a person, treat it as data loss until proven otherwise (§9) —
and do NOT confirm by re-snapshotting both sides without another reboot:
two post-reboot reads of the same live database are identical by
construction, so that "check" can only print a false pass. The only valid
re-test is the full cycle: new before-snapshot → reboot again → new
after-snapshot.

```sh
sudo reboot
```

After the machine comes back — **do not run any `docker compose` command**;
the point of this test is that the container came back by itself:

```sh
cd "$HOME/task-stack" || { echo "no app directory at $HOME/task-stack — cd to the deploy checkout first"; exit 1; }
set -euo pipefail
PORT="$(grep -E '^HOST_PORT=' .env | cut -d= -f2 || true)"; PORT="${PORT:-8181}"
BASE="http://127.0.0.1:$PORT"
docker ps --filter name=task-stack --filter status=running --format '{{.Names}}' | grep -qx task-stack \
  || { echo "container not running after boot — restart policy or daemon enablement failed (§9)"; exit 1; }
# Auto-start proof: the container's start time must sit within ~2 minutes of
# the machine's boot time — and AFTER it. StartedAt is UTC RFC3339 with
# nanoseconds; uptime -s is local time without a zone — normalise to the same
# epoch base before comparing (a naive compare false-rejects in non-UTC
# timezones). The window is two-sided on purpose: a start before this boot
# means the container never restarted at all, which must not print a success
# line.
started="$(docker inspect --format '{{.State.StartedAt}}' task-stack)"
boot="$(uptime -s)"
started="$(printf %s "$started" | sed -E 's/\.[0-9]+(Z)?$/Z/')"
drift=$(( $(date -d "$started" +%s) - $(date -d "$boot" +%s) ))
if [ "$drift" -gt 120 ]; then
  echo "container started ${drift}s after boot — that was a manual start (or a late daemon), not auto-start"; exit 1
fi
if [ "$drift" -lt -30 ]; then
  echo "container started before this boot (drift ${drift}s) — it never restarted: did the machine actually reboot, and is the docker daemon enabled at boot? (§2)"; exit 1
fi
echo "container auto-started with the machine (drift ${drift}s)"
curl --retry 10 --retry-delay 1 --retry-connrefused -fsS "$BASE/api/health"   # {"ok":true}
curl -fsS -o "$HOME/task-stack-state-after.json.tmp" "$BASE/api/state" \
  && mv "$HOME/task-stack-state-after.json.tmp" "$HOME/task-stack-state-after.json"
diff "$HOME/task-stack-state-before.json" "$HOME/task-stack-state-after.json"
# no output above = identical: the whole database survived the reboot, not just the process
```

Canary check and cleanup — required on a first deploy, optional
re-confirmation once the instance holds data:

```sh
cd "$HOME/task-stack" || { echo "no app directory at $HOME/task-stack — cd to the deploy checkout first"; exit 1; }
set -euo pipefail
PORT="$(grep -E '^HOST_PORT=' .env | cut -d= -f2 || true)"; PORT="${PORT:-8181}"
BASE="http://127.0.0.1:$PORT"
if read CANARY STACK PREV < "$HOME/task-stack-canary.txt" 2>/dev/null \
   && [ -n "$CANARY" ] && [ -n "$STACK" ]; then
  if grep -q "$CANARY" "$HOME/task-stack-state-after.json"; then
    echo "canary note survived — write path + WAL durability proven"
  else
    echo "CANARY LOST — writes did not survive the restart; stop and investigate (§9)"
    # Keep the evidence: the before/after pair is the only record of what was
    # or was not lost — deleting it would erase the diagnosis.
    stamp="$(date +%F-%H%M)"
    mv "$HOME/task-stack-state-before.json" "$HOME/task-stack-failed-$stamp-before.json"
    mv "$HOME/task-stack-state-after.json" "$HOME/task-stack-failed-$stamp-after.json"
    rm -f "$HOME/task-stack-canary.txt"
    exit 1   # before any cleanup: the canary stack and note stay as-is for inspection
  fi
  # Cleanup needs only the stack delete (server/src/stacks.ts):
  # DELETE /api/stacks/:id removes the stack's pending notes in the same
  # transaction, keeps completed_notes rows (stack_id nulled, stack_name
  # preserved), and — when the deleted stack was active — re-points
  # active_stack_id at the first survivor in drawer order. No note-level
  # delete is used anywhere in this runbook.
  code="$(curl -sS -o /dev/null -w '%{http_code}' -X DELETE "$BASE/api/stacks/$STACK")"
  [ "$code" = "200" ] || { echo "stack delete returned $code (404 = already gone; anything else = server trouble — inspect before retrying)"; }
  if [ -n "$PREV" ]; then
    code="$(curl -sS -o /dev/null -w '%{http_code}' -X PUT "$BASE/api/active" \
      -H 'content-type: application/json' -d "{\"stackId\":\"$PREV\"}")"
    [ "$code" = "200" ] || { echo "active-restore returned $code — set it in the UI instead"; }
  else
    echo "no previous active stack (fresh instance) — nothing to restore"
  fi
  rm -f "$HOME/task-stack-canary.txt" "$HOME/task-stack-state-before.json" "$HOME/task-stack-state-after.json"
else
  echo "no canary on file — fine once the instance holds data; on a first deploy the canary block above should have written it"
fi
```

## 5. updating to a new version

Trap first: compose interpolates `IMAGE_TAG` **from `.env`** when it builds
and starts services. With §6's pin (`IMAGE_TAG=rollback`) left in `.env`, a
bare `docker compose build` tags the *new* build `rollback` — orphaning the
known-good image, and the next §6 "rollback" would reinstall the bad build
while every check reports success. The block below pins `IMAGE_TAG=latest`
explicitly on both commands (shell variables take precedence over `.env`).

```sh
cd "$HOME/task-stack" || { echo "no app directory at $HOME/task-stack — cd to the deploy checkout first"; exit 1; }
set -euo pipefail
PORT="$(grep -E '^HOST_PORT=' .env | cut -d= -f2 || true)"; PORT="${PORT:-8181}"
BASE="http://127.0.0.1:$PORT"
grep -Eq '^\s*IMAGE_TAG\s*=\s*(latest\s*)?$' .env \
  || echo "WARNING: .env pins IMAGE_TAG — the build below uses an explicit IMAGE_TAG=latest override; unpin .env when you are happy with the new build"
git pull --ff-only
# Tag the RUNNING container's image id, not the latest tag — if you are
# currently sitting on a rollback (§6), tagging task-stack:latest would
# overwrite the known-good image with whatever latest points at now.
docker tag "$(docker inspect --format '{{.Image}}' task-stack)" task-stack:rollback
IMAGE_TAG=latest docker compose build    # set -e: a failed build aborts here, before up -d can answer anything
IMAGE_TAG=latest docker compose up -d
curl --retry 10 --retry-delay 1 --retry-connrefused -fsS "$BASE/api/health"   # {"ok":true}
```

If that health check fails, go straight to §6 — that is the moment the
rollback tag exists for.

To see which image compose will actually target (a client-side render, no
daemon needed):

```sh
cd "$HOME/task-stack" || { echo "no app directory at $HOME/task-stack — cd to the deploy checkout first"; exit 1; }
IMAGE_TAG=latest docker compose config | grep -E '^\s+image:'
```

Confirm the right image is running (the container's image id must match the
row tagged `latest` — or `rollback`, if you're rolled back per §6):

```sh
docker inspect --format '{{.Image}}' task-stack
docker image ls task-stack --format '{{.ID}} {{.Tag}}'
```

```sh
docker image prune -f --filter "label=com.docker.compose.project=task-stack"   # only once satisfied — and scoped: a bare -f prune is HOST-WIDE and would eat other stacks' dangling images on this VM; still only safe while task-stack:rollback still tags the previous image (a tagged image is not dangling)
```

The database and the image are independent: rebuilding and recreating the
container never touches `data/`.

## 6. rollback

```sh
cd "$HOME/task-stack" || { echo "no app directory at $HOME/task-stack — cd to the deploy checkout first"; exit 1; }
set -euo pipefail
PORT="$(grep -E '^HOST_PORT=' .env | cut -d= -f2 || true)"; PORT="${PORT:-8181}"
BASE="http://127.0.0.1:$PORT"
# Guard: with `build:` declared and the rollback tag missing, compose would
# BUILD the current checkout and tag it rollback — the bad version under a
# good name. This makes sure the tag exists first.
docker image inspect task-stack:rollback >/dev/null 2>&1 \
  || { echo "no rollback image — aborting (§5 is what creates the tag)"; exit 1; }
IMAGE_TAG=rollback docker compose up -d
curl --retry 10 --retry-delay 1 --retry-connrefused -fsS "$BASE/api/health"   # {"ok":true}
```

This works because the service declares `image: task-stack:${IMAGE_TAG:-latest}`
alongside `build:` — compose honours the variable and points the container at
the image retagged in §5. The guard above is what keeps it honest: without
it, a missing `rollback` tag would silently rebuild from the current
checkout.

Rollback is not sticky: `.env` still says `IMAGE_TAG=latest`, so the next
bare `docker compose up -d` jumps forward again. To *stay* rolled back, put
`IMAGE_TAG=rollback` in `.env`; to return to current, set it back to `latest`
(or delete the line) and `docker compose up -d`.

## 7. day-2 operations

```sh
cd "$HOME/task-stack" || { echo "no app directory at $HOME/task-stack — cd to the deploy checkout first"; exit 1; }            # docker compose commands need the project dir
docker compose logs --tail=100   # recent pino output
docker compose logs -f           # follow
docker compose exec app sh       # shell inside the container
docker compose restart           # bounce the process
docker compose stop              # stop (SIGTERM; the app closes the DB cleanly)
docker compose start             # start again
docker compose down              # remove container + network
```

`down` does **not** delete `./data` — the bind mount stays on the host.
`down -v` targets named volumes, which this project doesn't use; it's inert
here, but don't reach for it out of habit.

## 8. data, backups, and what not to do

The database lives at `./data/data.db` inside the app directory (the compose
bind mount).

The nightly backup job lands with T37 (not built yet). Until then, two
supported escape hatches:

- Live export, safe to run any time — to a **timestamped file outside the
  work tree** (a `backup.json` in the repo root would enter the Docker build
  context's `COPY . .` and be eaten by the very `git clean -fdx` warned
  about below; and shell `>` truncates its target before curl even
  connects, so a dead server would destroy the previous export):

  ```sh
  cd "$HOME/task-stack" || { echo "no app directory at $HOME/task-stack — cd to the deploy checkout first"; exit 1; }
  set -euo pipefail
  PORT="$(grep -E '^HOST_PORT=' .env | cut -d= -f2 || true)"; PORT="${PORT:-8181}"
  BASE="http://127.0.0.1:$PORT"
  out="$HOME/task-stack-export-$(date +%F-%H%M).json"
  # curl -o creates/truncates its output file as soon as the transfer starts,
  # so a failure can leave an empty or partial file behind (that is what
  # curl >= 7.83's --remove-on-error cleans up; Ubuntu 22.04 ships curl 7.81,
  # which predates it). The mv below is the same guarantee, portably: a
  # failed request leaves at most a junk .tmp outside the work tree, never a
  # destroyed previous export.
  curl -fsS -o "$out.tmp" "$BASE/api/export"
  mv "$out.tmp" "$out"
  test -s "$out" || { echo "export file missing/empty — server died mid-request?"; exit 1; }
  python3 -c 'import json,sys; json.load(open(sys.argv[1])); print("valid JSON")' "$out"
  ```

- File copy — stop, copy the siblings, start, destination **outside the work
  tree**:

  ```sh
  cd "$HOME/task-stack" || { echo "no app directory at $HOME/task-stack — cd to the deploy checkout first"; exit 1; }
  set -euo pipefail
  dest="$HOME/task-stack-backup-$(date +%F-%H%M)"
  mkdir -p "$dest"
  docker compose stop          # SIGTERM; the app closes the DB cleanly (WAL checkpointed)
  for f in data.db data.db-wal data.db-shm; do   # all three siblings, or whatever the checkpoint left
    [ -f "data/$f" ] && cp -a "data/$f" "$dest"/
  done
  docker compose start
  test -s "$dest/data.db" || { echo "no data.db copied — wrong directory or missing files"; exit 1; }
  ls -la "$dest"
  ```

  If your user is not uid 1000, the `cp` needs `sudo` — `chmod 700` on
  `data/` (below) limits it to that uid, the same constraint T37's job will
  have.

**`data/` lives inside the git work tree and is gitignored — `git clean -fdx`
deletes your database, your `.env`, and any export left inside the tree.**
Dry-run first (`git clean -fdxn`), or exclude both: `git clean -fdx -e data
-e .env`. Exports belong outside the work tree by construction (above).

`sudo chmod 700 "$HOME/task-stack/data"` is worth one line (`sudo` because
`data` is owned by uid 1000, so anyone else needs it; absolute path so a
wrong-directory run cannot chmod some other `~/data`): the directory holds
all the user's data and the service has no auth (`DECISIONS.md` §9).

## 9. troubleshooting

- **Container restarts in a loop; log shows `SQLITE_CANTOPEN` / `EACCES` on
  `/data/data.db`.** `data/` is root-owned (step 2 was skipped). Fix:
  `sudo chown 1000:1000 "$HOME/task-stack/data"` (absolute path — never
  re-chown a stray `~/data`), then `docker compose up -d`.
- **`listen EADDRINUSE` in the logs, or `Bind for 0.0.0.0:<HOST_PORT>
  failed: port is already allocated` at `up`.** Host port taken. Fix: set
  `HOST_PORT` in `.env`, `docker compose up -d` again.
- **`unknown field "name"` from a compose command.** The CLI predates the
  top-level `name:` attribute. Fix: upgrade `docker-compose-plugin`, or
  delete the `name:` line from `docker-compose.yml` — the project name then
  falls back to the directory base name, which is already `task-stack`.
- **`no configuration file provided: not found` from a compose command.**
  Wrong directory — compose found no `docker-compose.yml` where it ran. Fix:
  `cd "$HOME/task-stack"` first. (The different error `Services "app" doesn't
  have a build section` means a compose file WAS read but has no `build:`
  key — a `-f`/override file or the wrong project.)
- **Config error mentioning an empty `WEB_DIST_PATH` or a missing web dist.**
  Wrong build / `web/dist` missing from the image — never set that variable
  yourself; the Dockerfile owns it. Fix: rebuild from a clean checkout,
  `docker compose build --no-cache`.
- **Build fails at `pnpm install --frozen-lockfile`.** Lockfile/toolchain
  mismatch in the checkout. Fix: confirm `git status` is clean and you're on
  a commit where `pnpm-lock.yaml` matches the `package.json` files.
- **`pnpm install` or the base-image pull hangs/fails.** The builder stage
  needs internet access on the VM; there is no offline build path in v1.
- **§4 reports "container started before this boot — it never restarted".**
  The daemon was not enabled at boot, the machine never actually rebooted,
  or the clock skew exceeds the ±tolerance. Fix: `systemctl is-enabled
  docker`; if it is not `enabled`: `sudo systemctl enable docker`, reboot
  again, and re-run §4.
- **Container healthy but the page is blank.** Check the `/` status code
  (§3 step 6), `docker compose logs`, and the browser console first — the
  server sends `cache-control: public, max-age=0` on `/` (`@fastify/static`
  defaults, `server/src/static.ts`), so the page revalidates on every load
  and a stale cache is only plausible across a rebuild: hard-refresh clears
  an index.html cached from the previous image.
- **§4 reports "CANARY LOST".** Writes did not survive the restart. The
  block exits non-zero and KEEPS both snapshots (renamed
  `task-stack-failed-*`) — do not delete them and do not re-run the diff;
  they are the evidence. Check `data/` ownership (first row above), the WAL
  siblings in `data/`, and that the bind mount points at the directory you
  think it does. The canary stack may still be in the drawer — remove it
  from the UI only after the cause is fixed.
- **The §4 diff differs after a reboot.** Classify it first: a change
  confined to completed-note ordering (completed_at-driven) when the app was
  used during the reboot window is the one benign drift. A missing row, or
  any change outside that, is **data loss — stop, keep both snapshots, touch
  nothing, restore from backup**. To confirm a benign case, re-run the FULL
  cycle — new before-snapshot → reboot again → new after-snapshot — never
  "re-snapshot both sides": two post-reboot reads of the same live database
  are identical by construction and would print a false pass.

**Honesty note:** the image build has never been executed against a real
Docker daemon (the T35 caveat in `TASKS.md`) — the first `docker compose
build` on the VM is the real test of the `Dockerfile`. If `compose build`
hides a failure behind a wall of progress bars, get a legible one with:

```sh
cd "$HOME/task-stack" || { echo "no app directory at $HOME/task-stack — cd to the deploy checkout first"; exit 1; }
docker build --progress=plain -t task-stack:latest .
```

## 10. considered and deferred

- Caddy in front for TLS + a domain (`DECISIONS.md` §9) — when a domain is handy.
- `read_only` rootfs with a tmpfs `/tmp` — a hardening pass for later, not v1.
- Resource limits (`mem_limit`, `cpus`, `pids_limit`) — nothing to tune yet.
- A private registry for the image — moot while the VM builds it locally.
