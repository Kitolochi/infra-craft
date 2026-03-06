# Infrastructure & DevOps Toolkit — Node.js / TypeScript

Master reference for deployment, containerization, CI/CD, monitoring, and infrastructure.

---

## 1. Deployment Platforms

### Decision Matrix

| Platform | Best For | Pricing | DX | WebSockets | Scale-to-Zero |
|----------|----------|---------|-----|------------|---------------|
| **Vercel** | Next.js frontends | Per-request ($20/mo base) | Excellent | Limited | Yes |
| **Railway** | Full-stack apps | Usage-based ($8-15/mo typical) | Excellent | Yes | Yes |
| **Fly.io** | Real-time, edge, WebSockets | Per-second (~$2/mo min) | Good | Native | Yes |
| **Render** | Cost-conscious production | Predictable pricing | Good | Yes | Paid tier |
| **Coolify** | Self-hosted PaaS | Free (own hardware) | Good | Yes | No |
| **AWS ECS/Lambda** | Enterprise, complex arch | Pay-per-use | Steep | Lambda: no | Lambda: yes |
| **DigitalOcean** | Mid-size apps, simpler AWS | Usage-based | Good | Yes | Functions only |

### Recommendations by Use Case

| Use Case | Platform |
|----------|----------|
| Next.js frontend | Vercel |
| Full-stack API + DB | Railway |
| WebSocket/real-time | Fly.io |
| Budget production | Render |
| Self-hosted, full control | Coolify |
| Enterprise/compliance | AWS ECS |
| Simple serverless | DigitalOcean Functions |

---

## 2. Docker for Node.js

### Multi-Stage Build Template
```dockerfile
# Stage 1: Build
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Stage 2: Production
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
USER node
EXPOSE 3000
CMD ["node", "dist/server.js"]
```

### Best Practices Checklist
- `node:20-alpine` base (~180MB vs ~1GB standard)
- Copy `package*.json` first → `npm ci` → then source (layer caching)
- `USER node` for non-root execution
- `npm ci` not `npm install` (deterministic)
- `NODE_ENV=production` (30% less memory)
- `HEALTHCHECK` instruction for orchestrators
- `.dockerignore`: node_modules, .git, .env, dist, tests

### docker-compose for Local Dev
```yaml
services:
  api:
    build: .
    command: npx tsx watch server.ts
    volumes:
      - .:/app
      - /app/node_modules  # prevent host override
    ports:
      - "3000:3000"
    depends_on:
      redis:
        condition: service_healthy
  redis:
    image: redis:7-alpine
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
```

---

## 3. CI/CD — GitHub Actions

### Node.js Pipeline Template
```yaml
name: CI
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  ci:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npm run lint
      - run: npm test
      - run: npm run build
```

### Security Best Practices
- Pin action versions to SHA (not tags)
- Set `permissions: contents: read` explicitly
- Never echo secrets in logs
- Use environment protection rules for production deploys

### Branch Protection
- Require PR reviews before merge
- Require status checks to pass
- Use environment-specific branch restrictions
- Preview deployments on PRs (Vercel/Railway auto-preview)

---

## 4. Monitoring & Observability

### The Modern Stack (2026)

| Layer | Tool | Purpose |
|-------|------|---------|
| **Instrumentation** | OpenTelemetry | Vendor-neutral traces, metrics, logs |
| **Error Tracking** | Sentry | Error capture, performance monitoring |
| **Metrics** | Prometheus | Time-series metrics collection |
| **Visualization** | Grafana | Dashboards, alerting |
| **Log Aggregation** | Axiom / BetterStack | Centralized log search |

### OpenTelemetry (Standard)
```bash
npm i @opentelemetry/sdk-node @opentelemetry/auto-instrumentations-node
```
- Vendor-neutral — export to Sentry, Grafana, Axiom, any OTLP backend
- Auto-instrumentation for Express, Fastify, pg, Redis, etc.
- All major tools now integrate natively

### Sentry
```bash
npm i @sentry/node
```
- Error tracking + performance monitoring
- Uses OpenTelemetry under the hood
- Automatic span capture, source maps

### Grafana Free Tier (2026)
- 10K Prometheus metrics
- 50GB logs + 50GB traces
- Grafana Alloy: unified telemetry pipeline

---

## 5. Reverse Proxy

### Decision Matrix

| Proxy | Performance | Auto-SSL | Config DX | Docker Native | Best For |
|-------|------------|----------|-----------|--------------|----------|
| **Nginx** | Best | Manual | Verbose | No | High-traffic production |
| **Caddy** | Great | Automatic | Excellent | No | New projects, simplicity |
| **Traefik** | Good | Automatic | Labels | Yes | Containerized/microservices |

### Progression Path
1. **Start with Caddy** — zero-config HTTPS, readable Caddyfile
2. **Move to Traefik** — when containers/microservices dominate
3. **Graduate to Nginx** — when you need maximum performance tuning

### Caddy — Minimal Config
```
example.com {
    reverse_proxy localhost:3000
}
```
That's it. Auto HTTPS via Let's Encrypt.

### Traefik — Docker Labels
```yaml
services:
  api:
    labels:
      - traefik.http.routers.api.rule=Host(`api.example.com`)
      - traefik.http.services.api.loadbalancer.server.port=3000
```

---

## 6. Process Management

### PM2 (Production)
```bash
npm i -g pm2
pm2 start dist/server.js -i max    # cluster mode (all CPUs)
pm2 startup systemd                 # auto-start on reboot
pm2 save                            # save process list
```
- 100M+ downloads
- Built-in load balancer (cluster mode)
- Auto-restart on crash
- Use ecosystem.config.js for version-controlled config
- Apps must be stateless for cluster mode

### When to Use What
| Scenario | Tool |
|----------|------|
| VPS/bare metal | PM2 |
| Containers | Docker restart policies |
| Kubernetes | Pod management |
| Serverless | Platform-managed |

---

## 7. Infrastructure as Code

### Pulumi (TypeScript-native)
```bash
npm i @pulumi/pulumi @pulumi/aws
```
- Write infra in TypeScript with full type safety
- IDE autocomplete, compile-time checks
- Access to npm ecosystem
- Best for: TypeScript teams wanting IaC in their language

### SST (Serverless Stack)
```bash
npm i sst
```
- Full-stack apps on AWS, defined in `sst.config.ts`
- Live Lambda dev (local development with auto-reload)
- Note: development slowed in 2025 (team shifted to OpenCode)
- Still works, but evaluate alternatives for new projects

### Terraform
- HCL language (not TypeScript)
- Most widely adopted IaC tool
- Best for: multi-cloud, established teams

---

## 8. DNS & SSL

### Cloudflare (Recommended)
- Free Universal SSL for all domains
- Auto-renewal, 15min-24hr issuance
- Global anycast DNS
- DNS-over-TLS support

### Certificate Tiers
| Tier | Cost | Use Case |
|------|------|----------|
| Universal SSL | Free | Most apps |
| Advanced | Paid | Custom SANs |
| Custom | Enterprise | Bring your own cert |

---

## Install Reference

```bash
# Docker
docker --version                       # Verify Docker installed

# PM2
npm i -g pm2                           # Process manager

# Monitoring
npm i @sentry/node                     # Error tracking
npm i @opentelemetry/sdk-node          # Instrumentation
npm i @opentelemetry/auto-instrumentations-node

# Infrastructure as Code
npm i @pulumi/pulumi @pulumi/aws       # Pulumi (TypeScript IaC)

# Reverse Proxy (install via OS package manager)
# Caddy: curl -fsSL https://caddyserver.com/api/download
# Traefik: Docker image traefik:v3.0
# Nginx: apt install nginx / brew install nginx
```
