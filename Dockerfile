# syntax=docker/dockerfile:1

# Toolchain pins (mise.toml is the source of truth). The ARGs below, the base
# image tags they feed, and the guard in the builder honor those pins without
# pulling mise itself into the image — the official node image already ships
# the exact Node build, and only pnpm needs installing on top.
ARG NODE_VERSION=24.22.1
ARG PNPM_VERSION=12.15.0

# --- builder: install deps, build all packages, assemble the deploy payload ---
FROM node:${NODE_VERSION}-alpine AS builder

# Global ARGs are out of scope inside a stage — re-declare to inherit the
# global defaults / --build-arg values for the guard and pnpm install below.
ARG NODE_VERSION
ARG PNPM_VERSION

WORKDIR /repo

# Fail fast if the pins below ever drift from mise.toml.
COPY mise.toml ./
RUN grep -qx "node = \"${NODE_VERSION}\"" mise.toml \
  && grep -qx "pnpm = \"${PNPM_VERSION}\"" mise.toml

# npm ships inside the node image; only pnpm is missing.
RUN npm install --global pnpm@"${PNPM_VERSION}"

# Workspace manifests first so pnpm install layers are cacheable.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY server/package.json server/package.json
COPY shared/package.json shared/package.json
COPY web/package.json web/package.json

RUN pnpm install --frozen-lockfile

# Then the sources, and build the whole workspace.
COPY . .
RUN pnpm build \
  && pnpm --filter @task-stack/server deploy --prod /deploy

# --- runtime: only dist + prod node_modules + the built web app ---
FROM node:${NODE_VERSION}-alpine AS runtime

# npm/corepack/yarn are dead weight in the runtime image (the server is a
# single `node` process with no package-manager needs); node itself stays.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
  /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
  /usr/local/bin/pnpm /usr/local/bin/pnpx \
  /usr/local/bin/yarn /usr/local/bin/yarnpkg /opt/yarn-v*

WORKDIR /app
ENV HOST=0.0.0.0 \
  PORT=3000 \
  DB_PATH=/data/data.db \
  WEB_DIST_PATH=/app/web/dist

# /deploy carries server/dist + prod node_modules but also src/ and a stray
# data.db — copy only what the runtime needs, never the DB.
COPY --from=builder --chown=node:node /deploy/dist /app/server/dist
# package.json marks server/dist explicitly ESM ("type": "module") — Node's
# syntax detection would also load it, but the metadata keeps that load
# unambiguous. Its file: workspace dep is inert; no runtime install happens.
COPY --from=builder --chown=node:node /deploy/package.json /app/server/package.json
COPY --from=builder --chown=node:node /deploy/node_modules /app/server/node_modules
COPY --from=builder --chown=node:node /repo/web/dist /app/web/dist

# Volume for the SQLite database, writable by the node user.
RUN mkdir -p /data \
  && chown node:node /data
VOLUME ["/data"]

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>{process.exit(r.ok?0:1)}).catch(()=>process.exit(1))"

CMD ["node", "server/dist/index.js"]
