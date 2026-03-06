# Infrastructure Pattern Catalog

Working examples for deployment, Docker, CI/CD, monitoring, and infrastructure.

Status: [x] = built, [ ] = available to build

---

## Category 1: Docker

- [x] **Node.js Dockerfile** — Multi-stage build, Alpine, non-root user, health check. *(built: docker/node-dockerfile)*
- [x] **Docker Compose Dev** — API + Postgres + Redis with volumes and health checks. *(built: docker/docker-compose-dev)*
- [ ] **Docker Compose Full Stack** — Frontend + API + DB + Redis + Nginx reverse proxy.
- [ ] **Docker Build Optimization** — Layer caching, .dockerignore, build args, secrets.

## Category 2: CI/CD

- [x] **GitHub Actions — Node.js CI** — Lint, test, build on push/PR. npm cache. Matrix Node versions. *(built: ci-cd/github-actions-node)*
- [ ] **GitHub Actions — Deploy Railway** — CI + auto-deploy to Railway on main push.
- [ ] **GitHub Actions — Deploy Fly.io** — CI + flyctl deploy with health check.
- [ ] **GitHub Actions — Docker Build + Push** — Build image, push to GHCR, deploy.
- [ ] **Branch Protection Config** — Required reviews, status checks, environment rules.
- [ ] **Preview Deployments** — PR-based preview environments with cleanup.

## Category 3: Monitoring

- [ ] **OpenTelemetry Setup** — Auto-instrumentation for Express/Fastify, OTLP export.
- [ ] **Sentry Integration** — Error tracking + performance monitoring for Node.js.
- [ ] **Prometheus Metrics** — Custom metrics endpoint, histograms, counters.
- [x] **Health Check Patterns** — Liveness, readiness, startup probes with dependency checks. *(built: monitoring/health-checks)*
- [ ] **Structured Logging** — Pino + OpenTelemetry trace correlation.

## Category 4: Reverse Proxy

- [ ] **Caddy Config** — Reverse proxy + auto-HTTPS + custom headers.
- [ ] **Nginx Config** — Reverse proxy + SSL + rate limiting + caching.
- [ ] **Traefik + Docker** — Auto-discovery with Docker labels, Let's Encrypt.

## Category 5: Deployment

- [ ] **Railway Config** — railway.toml, env vars, nixpacks config.
- [ ] **Fly.io Config** — fly.toml, multi-region, auto-scaling, volumes.
- [x] **PM2 Ecosystem** — ecosystem.config.js, cluster mode, log rotation. *(built: deployment/pm2-ecosystem)*
- [x] **Graceful Shutdown** — SIGTERM handling, connection draining, cleanup hooks. *(built: deployment/graceful-shutdown)*

## Category 6: Infrastructure as Code

- [ ] **Pulumi — S3 + CloudFront** — Static site hosting with TypeScript IaC.
- [ ] **Pulumi — ECS Service** — Containerized API on AWS ECS Fargate.
- [ ] **Terraform — Basic VPS** — Provision DigitalOcean droplet with Terraform.

---

## Build Priority

**Tier 1 — Essentials:**
1. Node.js Dockerfile
2. Docker Compose Dev
3. GitHub Actions — Node.js CI
4. Health Check Patterns
5. Graceful Shutdown
6. PM2 Ecosystem

**Tier 2 — Production:**
7. Caddy Config
8. OpenTelemetry Setup
9. Sentry Integration
10. GitHub Actions — Deploy Railway
11. Railway Config

**Tier 3 — Advanced:**
12. Docker Compose Full Stack
13. Traefik + Docker
14. Prometheus Metrics
15. Fly.io Config
16. Pulumi — S3 + CloudFront
