# Infrastructure Decision Frameworks

Opinionated guides for common infrastructure choices. Each section gives a default, explains when to deviate, and provides a comparison table.

---

## Container Images: Chainguard vs Alpine vs Distroless

**Default choice:** Alpine — widest ecosystem support, small images, battle-tested.

**Choose Chainguard when:** You need zero-CVE base images, run in regulated environments (SOC2, HIPAA), or want to eliminate "noise" CVEs from security scans entirely.

**Choose Alpine when:** You need a shell for debugging, want the largest community support, or your team is already standardized on it.

**Choose Distroless when:** You want Google-backed minimal images but don't need Chainguard's update cadence or commercial support.

| Factor | Alpine | Chainguard | Distroless |
|--------|--------|------------|------------|
| Base image size | ~5MB | ~20MB | ~15MB |
| CVE count (typical) | 0-5 low/medium | 0 | 0-2 |
| Shell available | Yes (ash) | No | No |
| Package manager | apk | No | No |
| Update cadence | Community | Daily rebuilds | Periodic |
| Debugging | Easy (shell) | Hard (debug variant) | Hard (debug variant) |
| Node.js image | node:20-alpine | cgr.dev/chainguard/node | gcr.io/distroless/nodejs |

**Our pick:** Alpine for development, Chainguard for production containers exposed to the internet.

---

## Observability: Grafana LGTM vs Prometheus+Jaeger vs SaaS

**Default choice:** Prometheus + Grafana + Jaeger (self-hosted) — free, proven, full control.

**Choose Grafana LGTM stack when:** You want a unified backend (Loki for logs, Grafana for dashboards, Tempo for traces, Mimir for metrics) with a single query language (LogQL/TraceQL).

**Choose Prometheus+Jaeger when:** You already run them, want minimal moving parts, or only need metrics + traces without centralized logging.

**Choose SaaS (Datadog, New Relic, Honeycomb) when:** You have budget, need minimal ops overhead, or want advanced features (AI-powered alerting, SLO tracking, distributed profiling) out of the box.

| Factor | Prometheus+Jaeger | Grafana LGTM | SaaS (Datadog) |
|--------|-------------------|--------------|----------------|
| Cost | Free (infra only) | Free (infra only) | $15-30/host/mo |
| Setup complexity | Medium | High | Low |
| Metrics | Prometheus | Mimir | Built-in |
| Traces | Jaeger | Tempo | Built-in |
| Logs | Separate (ELK/Loki) | Loki | Built-in |
| Dashboards | Grafana | Grafana | Built-in |
| Alerting | Alertmanager | Grafana Alerting | Built-in + AI |
| Retention | You manage | You manage | Included |
| Vendor lock-in | None | None | High |

**Our pick:** Start with Prometheus + Grafana + Jaeger. Add Loki when you need centralized logs. Move to SaaS only when the ops burden outweighs the cost.

---

## IaC: Pulumi vs Terraform vs CDK

**Default choice:** Pulumi — real programming languages, type safety, native testing.

**Choose Pulumi when:** Your team writes TypeScript/Python daily, you want type-checked infrastructure, or you need complex logic (loops, conditionals, abstractions) without HCL workarounds.

**Choose Terraform when:** Your team already knows HCL, you need the largest provider ecosystem, or your organization has standardized on it. The community and hiring pool are unmatched.

**Choose CDK when:** You're all-in on AWS, want CloudFormation under the hood, or need tight integration with AWS-specific services (Step Functions, AppSync).

| Factor | Pulumi | Terraform | CDK |
|--------|--------|-----------|-----|
| Language | TS, Python, Go, C# | HCL | TS, Python, Go, C# |
| State management | Cloud/self-hosted | Cloud/self-hosted | CloudFormation |
| Testing | Native unit tests | Terratest | CDK assertions |
| Multi-cloud | Yes | Yes (strongest) | AWS only |
| Learning curve | Low (if you know TS) | Medium (HCL) | Medium |
| Provider coverage | Good (Terraform bridge) | Best | AWS only |
| Import existing | pulumi import | terraform import | cdk import |
| Drift detection | Yes | Yes | Limited |

**Our pick:** Pulumi for TypeScript teams. Terraform if you need the broadest ecosystem or HCL expertise already exists.

---

## Orchestration: PM2 -> Compose -> Swarm -> K8s

**Default choice:** Docker Compose — right-sized for most projects, zero learning curve beyond Docker.

**PM2** (1-3 services, single server):
- Process manager, not container orchestrator
- Use for: single VPS deployments, hobby projects, quick prototypes
- Outgrow when: you need container isolation or multi-host deployment

**Docker Compose** (3-15 services, 1-3 servers):
- Use for: development environments, staging, small production deployments
- Outgrow when: you need auto-scaling, multi-host networking, or zero-downtime deploys across nodes

**Docker Swarm** (10-50 services, 3-10 nodes):
- Use for: teams that know Compose and need multi-host + rolling deploys without K8s complexity
- Outgrow when: you need advanced scheduling, service mesh, or ecosystem integrations

**Kubernetes** (50+ services, 10+ nodes, multiple teams):
- Use for: large-scale production, multi-team organizations, complex deployment topologies
- Consider managed K8s (EKS, GKE, AKS) to reduce ops burden

| Factor | PM2 | Compose | Swarm | K8s |
|--------|-----|---------|-------|-----|
| Learning curve | Minimal | Low | Medium | High |
| Multi-host | No | No (native) | Yes | Yes |
| Auto-scaling | No | No | Limited | Yes |
| Rolling deploys | Manual | Manual | Yes | Yes |
| Service mesh | No | No | No | Yes (Istio, Linkerd) |
| Config management | .env files | .env + yaml | Secrets/configs | ConfigMaps/Secrets |
| Health checks | Basic | Basic | Built-in | Advanced (liveness, readiness) |

**Our pick:** Docker Compose for everything until you genuinely need multi-host orchestration. Most teams jump to K8s too early.
