# =============================================================================
# Optimized Production Dockerfile — Multi-Stage with Layer Caching
# =============================================================================
#
# This Dockerfile demonstrates production-grade optimization techniques:
#   1. Multi-stage builds (deps → build → production)
#   2. Layer caching strategies for fast rebuilds
#   3. BuildKit cache mounts for npm
#   4. Security hardening (non-root user, no secrets, minimal base)
#   5. Distroless-style minimal final image
#
# Build:
#   DOCKER_BUILDKIT=1 docker build -t my-app .
#   DOCKER_BUILDKIT=1 docker build --target production -t my-app:prod .
#
# Before/After comparison (typical Node.js TypeScript API):
# ┌─────────────────────────┬──────────────┬──────────────┐
# │ Metric                  │ Naive Build  │ Optimized    │
# ├─────────────────────────┼──────────────┼──────────────┤
# │ Image size              │ ~1.2 GB      │ ~150 MB      │
# │ Build time (cold)       │ ~120s        │ ~90s         │
# │ Build time (code only)  │ ~120s        │ ~15s         │
# │ Build time (cached)     │ ~120s        │ ~5s          │
# │ Attack surface (CVEs)   │ High (Debian)│ Low (Alpine) │
# │ Running as root         │ Yes          │ No           │
# │ Secrets in image        │ Possible     │ No           │
# │ Dev dependencies        │ Included     │ Excluded     │
# │ TypeScript source       │ Included     │ Excluded     │
# └─────────────────────────┴──────────────┴──────────────┘
#
# Why these sizes? A naive "COPY . && npm install && npm build" includes:
#   - Full Debian OS (~350 MB)     vs Alpine (~8 MB)
#   - devDependencies (~200 MB)    vs production only (~50 MB)
#   - TypeScript source + .git     vs compiled JS only
#   - npm cache (~100 MB)          vs cleaned
#
# =============================================================================

# ---------------------------------------------------------------------------
# Stage 1: Dependencies — install and cache node_modules
# ---------------------------------------------------------------------------
# Separating dependency installation into its own stage means:
#   - Code changes DON'T re-install dependencies (cached layer)
#   - tsconfig/source changes DON'T re-install dependencies
#   - Only package.json/lock file changes trigger npm ci
#
# This is the single biggest optimization for build speed. On a typical
# project, npm ci takes 30-60 seconds. Caching it saves that on every
# code-only rebuild.

FROM node:20-alpine AS deps

WORKDIR /app

# Copy ONLY package manifests. This layer is cached until these files change.
# The order matters: most-stable files first, most-volatile files last.
COPY package.json package-lock.json ./

# BuildKit cache mount: persists the npm cache across builds.
# Without this, every "docker build" downloads all packages from scratch.
# The cache mount lives on the Docker host (not in the image) so it:
#   - Survives image rebuilds
#   - Doesn't increase image size
#   - Is shared across builds of the same Dockerfile
#
# --mount=type=cache,target=/root/.npm
#   Mounts the host's npm cache directory into the build container.
#   npm ci checks this cache before downloading from the registry.
#
# npm ci vs npm install:
#   ci = clean install from lock file (deterministic, faster, CI-safe)
#   install = resolves versions, may update lock file (not what you want)
RUN --mount=type=cache,target=/root/.npm \
    npm ci

# Install production dependencies separately for the final stage.
# This avoids installing devDependencies in the production image.
RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev --prefix /app/prod-deps --ignore-scripts && \
    cp package.json package-lock.json /app/prod-deps/

# ---------------------------------------------------------------------------
# Stage 2: Build — compile TypeScript to JavaScript
# ---------------------------------------------------------------------------
# This stage has access to devDependencies (TypeScript compiler, build tools)
# but nothing from here ends up in the final image except the compiled output.

FROM node:20-alpine AS build

WORKDIR /app

# Copy node_modules from deps stage (includes devDependencies for build).
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/package.json ./package.json

# Copy source files. These layers bust the cache on every code change,
# but that's fine — deps are already cached above.
COPY tsconfig.json ./
COPY src/ ./src/

# Compile TypeScript.
# Output goes to /app/dist/ (configured in tsconfig.json).
# If you have additional build steps (CSS, asset pipeline), add them here.
RUN npx tsc --project tsconfig.json

# ---------------------------------------------------------------------------
# Stage 3: Production — minimal runtime image
# ---------------------------------------------------------------------------
# Start from a clean Alpine image. Nothing from previous stages carries over
# unless explicitly COPYed. This ensures:
#   - No TypeScript compiler or devDependencies
#   - No source .ts files
#   - No build artifacts or intermediate files
#   - No npm cache
#
# Alternative: Google's distroless (gcr.io/distroless/nodejs20-debian12)
# Even smaller (~120 MB) and has no shell at all — you can't exec into the
# container, which is a security win. Trade-off: harder to debug.

FROM node:20-alpine AS production

# OCI labels for container registries and orchestration tooling.
LABEL org.opencontainers.image.title="optimized-node-app"
LABEL org.opencontainers.image.description="Production-optimized Node.js application"

# Set NODE_ENV before anything else. This affects:
#   - Express: disables verbose error pages, enables view caching
#   - Many npm packages: enable production optimizations
#   - npm: skips devDependencies on install
ENV NODE_ENV=production

WORKDIR /app

# Copy production-only node_modules from the deps stage.
# This excludes TypeScript, test frameworks, linters, and other dev tools
# that can cut node_modules size by 50-80%.
COPY --from=deps /app/prod-deps/node_modules ./node_modules
COPY --from=deps /app/prod-deps/package.json ./package.json

# Copy ONLY compiled JavaScript from the build stage.
# No .ts source, no tsconfig, no test files.
COPY --from=build /app/dist ./dist

# ---------------------------------------------------------------------------
# Security: non-root user
# ---------------------------------------------------------------------------
# By default, Docker runs processes as root (UID 0). If an attacker exploits
# a vulnerability in your app, they have root access to the container —
# and potentially the host if there's a container escape.
#
# The official Node.js Alpine image creates a "node" user (UID 1000).
# We switch to it after copying files (COPY runs as root by default).
#
# Additional hardening options (not shown):
#   - Read-only filesystem: docker run --read-only
#   - Drop all capabilities: docker run --cap-drop=ALL
#   - No new privileges: docker run --security-opt=no-new-privileges
USER node

# Document the exposed port. This is metadata — use -p to actually publish.
EXPOSE 3000

# Health check for orchestrators (Docker Swarm, ECS, Compose).
# Kubernetes uses its own probe configuration, so this is ignored there.
# wget is used because Alpine doesn't include curl by default.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

# Use exec form (JSON array) so Node.js receives SIGTERM directly.
# Shell form (CMD node dist/index.js) wraps in /bin/sh, which swallows
# signals — preventing graceful shutdown and causing 10-second kill delays.
CMD ["node", "dist/index.js"]
