# =============================================================================
# Backend image — multi-stage.
#
# Stage 1 (deps)    installs the full dependency tree once, so the layer is
#                   cached until package-lock.json changes.
# Stage 2 (build)   compiles TypeScript and generates the Prisma client.
# Stage 3 (runtime) copies only `dist`, production node_modules and the Prisma
#                   artefacts. No TypeScript compiler, no dev dependencies, no
#                   source — a smaller image is also a smaller attack surface.
# =============================================================================

# --- Stage 1: dependencies ---------------------------------------------------
FROM node:20-alpine AS deps

WORKDIR /app

# Copy manifests only. Copying source here would invalidate this layer on every
# code change and force a reinstall on every build.
COPY package.json package-lock.json ./
COPY prisma ./prisma

# `npm ci` installs exactly the lockfile — reproducible, unlike `npm install`.
# The postinstall hook runs `prisma generate`, which needs prisma/ (copied above).
RUN npm ci --ignore-scripts && npx prisma generate


# --- Stage 2: build ----------------------------------------------------------
FROM node:20-alpine AS build

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN npx prisma generate && npx tsc -p tsconfig.build.json


# --- Stage 3: runtime --------------------------------------------------------
FROM node:20-alpine AS runtime

WORKDIR /app

ENV NODE_ENV=production
# Node does not reap zombie processes as PID 1; tini does, and it forwards
# SIGTERM so the graceful-shutdown handler in server.ts actually runs.
RUN apk add --no-cache tini

# Run as a non-root user. The node image ships an unprivileged `node` user.
# A container process running as root that is compromised is root on the host
# namespace by default.
COPY --chown=node:node package.json package-lock.json ./
COPY --chown=node:node prisma ./prisma

RUN npm ci --omit=dev --ignore-scripts && npx prisma generate && npm cache clean --force

COPY --chown=node:node --from=build /app/dist ./dist

USER node

EXPOSE 4000

# Container-level health check, independent of the orchestrator's.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:4000/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/server.js"]
