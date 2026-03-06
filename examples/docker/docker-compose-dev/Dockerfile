# =============================================================================
# Development Dockerfile — Hot Reload with tsx
# =============================================================================
# Unlike the production Dockerfile, this installs ALL dependencies (including
# devDependencies like tsx, TypeScript, etc.) and uses tsx watch mode for
# instant reloads on file changes. No build step needed.
# =============================================================================

FROM node:20-alpine

WORKDIR /app

# Copy package manifests and install ALL dependencies (dev + prod).
# In development we need tsx (for hot reload), TypeScript types, etc.
COPY package.json package-lock.json ./
RUN npm ci

# Copy source code.
# In docker-compose.yml we bind-mount ./src over /app/src, so this COPY
# only matters for the initial build. After that, file changes on the
# host are reflected immediately via the volume mount.
COPY tsconfig.json ./
COPY src/ ./src/

# Expose the API port.
EXPOSE 3000

# Use tsx watch for hot reload.
# tsx is a TypeScript executor that runs .ts files directly without a
# compile step. The --watch flag restarts the process on file changes.
# We use the array form so Node.js receives signals (SIGTERM) directly.
CMD ["npx", "tsx", "watch", "src/index.ts"]
