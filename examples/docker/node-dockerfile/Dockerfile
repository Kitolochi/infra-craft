# =============================================================================
# Production Multi-Stage Dockerfile for Node.js TypeScript API
# =============================================================================
# Why multi-stage? The build stage includes TypeScript, devDependencies, and
# source files — none of which belong in production. By splitting stages we
# get a minimal, secure image with only the compiled JS and prod dependencies.
# =============================================================================

# ---------------------------------------------------------------------------
# Stage 1: Build
# ---------------------------------------------------------------------------
# We use Alpine for smaller base image (~50MB vs ~350MB for Debian).
# Pin to a major version (node:20-alpine) so patches auto-apply on rebuild,
# but breaking changes don't surprise you.
FROM node:20-alpine AS build

# Set working directory inside the container.
# All subsequent commands run relative to this path.
WORKDIR /app

# Copy package manifests FIRST, before source code.
# Docker caches each layer — if package.json hasn't changed, `npm ci` is
# skipped on rebuild. This dramatically speeds up iterative builds since
# source code changes far more often than dependencies.
COPY package.json package-lock.json ./

# `npm ci` (clean install) is preferred over `npm install` for CI/Docker:
# - Installs exact versions from package-lock.json (deterministic)
# - Faster than `npm install` (skips dependency resolution)
# - Fails if lock file is out of sync with package.json (catches mistakes)
RUN npm ci

# Now copy the rest of the source code.
# This layer is invalidated on every code change, but the npm ci layer above
# is cached, so rebuilds after code-only changes are fast.
COPY tsconfig.json ./
COPY src/ ./src/

# Compile TypeScript to JavaScript.
# Output goes to /app/dist/ (configured in tsconfig.json).
RUN npx tsc

# ---------------------------------------------------------------------------
# Stage 2: Production
# ---------------------------------------------------------------------------
# Start from a fresh Alpine image — nothing from the build stage carries over
# unless we explicitly COPY it. This means no TypeScript compiler, no
# devDependencies, no source .ts files in the final image.
FROM node:20-alpine AS production

# OCI labels provide standardized metadata for container registries and
# orchestration tools. These are the successor to LABEL maintainer.
LABEL org.opencontainers.image.title="node-api"
LABEL org.opencontainers.image.description="Production Node.js TypeScript API"
LABEL org.opencontainers.image.authors="your-team@example.com"
LABEL org.opencontainers.image.source="https://github.com/your-org/your-repo"
LABEL org.opencontainers.image.licenses="MIT"

# Set NODE_ENV before npm ci so npm knows to skip devDependencies.
# Many libraries also check this to enable production optimizations
# (e.g., Express disables verbose error pages).
ENV NODE_ENV=production

WORKDIR /app

# Copy package manifests and install production-only dependencies.
# --omit=dev excludes devDependencies (TypeScript, test frameworks, etc.)
# which can cut node_modules size by 50-80%.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copy ONLY the compiled JavaScript from the build stage.
# No TypeScript source, no build tooling, no test files.
COPY --from=build /app/dist ./dist

# Security: Run as a non-root user.
# By default, Docker runs processes as root. If an attacker exploits a
# vulnerability in your app, they'd have root access to the container.
# The `node` user is created by the official Node.js image.
USER node

# Expose the port the app listens on.
# This is documentation — it doesn't actually publish the port.
# Use `docker run -p 3000:3000` to publish it.
EXPOSE 3000

# HEALTHCHECK tells Docker how to verify the container is working.
# Orchestrators (Docker Swarm, ECS) use this to restart unhealthy containers.
# --interval: check every 30 seconds
# --timeout: fail if no response within 5 seconds
# --start-period: give the app 10 seconds to start before checking
# --retries: mark unhealthy after 3 consecutive failures
# We use wget instead of curl because Alpine doesn't include curl by default.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

# Use the array form of CMD (exec form) so Node.js receives signals directly.
# The string form (`CMD "node dist/index.js"`) runs via /bin/sh, which swallows
# SIGTERM — preventing graceful shutdown.
CMD ["node", "dist/index.js"]
