# Production Multi-Stage Dockerfile for Node.js TypeScript API

A production-ready Docker setup for Node.js TypeScript APIs using multi-stage builds.

## What's Included

- **Multi-stage build** — TypeScript compiles in a build stage; only compiled JS ships to production
- **Alpine base** — ~50MB base image vs ~350MB for Debian variants
- **Layer caching** — Package manifests copied before source so `npm ci` is cached across code changes
- **Non-root user** — Container runs as `node` user, not root
- **Health check** — Built-in Docker HEALTHCHECK for orchestrator integration
- **OCI labels** — Standardized image metadata

## Prerequisites

Your project needs:
- `package.json` and `package-lock.json` at the root
- `tsconfig.json` configured with `"outDir": "./dist"`
- Source files in `src/` with entry point at `src/index.ts`

## Build

```bash
# Build the image
docker build -t my-api .

# Build with a specific tag
docker build -t my-api:1.0.0 .

# Build with build arguments (e.g., for private npm registry)
docker build --build-arg NPM_TOKEN=xxx -t my-api .
```

## Run

```bash
# Run in foreground
docker run -p 3000:3000 my-api

# Run in background
docker run -d -p 3000:3000 --name my-api my-api

# Run with environment variables
docker run -d -p 3000:3000 \
  -e DATABASE_URL=postgres://... \
  -e REDIS_URL=redis://... \
  my-api

# Check health
docker inspect --format='{{.State.Health.Status}}' my-api
```

## Customization

| Change | How |
|--------|-----|
| Node.js version | Change `node:20-alpine` to `node:22-alpine` in both stages |
| Entry point | Update `CMD ["node", "dist/index.js"]` to match your entry file |
| Port | Update `EXPOSE` and the HEALTHCHECK URL |
| Health endpoint | Change `/health` in the HEALTHCHECK to your actual health path |
| Additional build steps | Add them after `RUN npx tsc` in the build stage |

## Image Size

Typical sizes with this setup:

| Component | Size |
|-----------|------|
| Base (node:20-alpine) | ~50MB |
| Production deps (typical) | 20-80MB |
| Compiled JS | 1-5MB |
| **Total** | **~70-135MB** |

Compare to a naive single-stage build with Debian: 400-800MB.
