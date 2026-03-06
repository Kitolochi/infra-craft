# Infrastructure Craft

Deployment configs, Docker templates, CI/CD workflows, monitoring setup, and reverse proxy configs for Node.js + TypeScript projects.

## Structure

```
catalog/            Reference docs and pattern checklists
examples/
  docker/           Dockerfiles, docker-compose configs
  ci-cd/            GitHub Actions workflows
  monitoring/       OpenTelemetry, Sentry, Prometheus
  deployment/       Railway, Fly.io, PM2 configs
  reverse-proxy/    Caddy, Nginx, Traefik configs
```

## Catalog

- **INFRA_TOOLKIT.md** — Platforms, Docker, CI/CD, monitoring, proxies, IaC with decision matrices
- **PATTERN_CATALOG.md** — 25+ infra patterns organized by category with build status

## Tech

- Docker + Docker Compose
- GitHub Actions
- OpenTelemetry + Sentry + Prometheus
- Caddy / Nginx / Traefik
- PM2, Pulumi
