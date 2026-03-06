// =============================================================================
// Health Check Server — Liveness, Readiness, Startup, and Metrics
// =============================================================================
// Run: npx tsx server.ts
//
// Endpoints:
//   GET /health   — Liveness probe: is the process alive?
//   GET /ready    — Readiness probe: can the app serve traffic?
//   GET /startup  — Startup probe: has the app finished initializing?
//   GET /metrics  — Basic application metrics
//
// Kubernetes / Docker uses these to decide:
//   /startup  → Has the container started? (checked first, then stops)
//   /health   → Is the container alive? (restart if failing)
//   /ready    → Can the container accept traffic? (remove from load balancer if not)
// =============================================================================

import express, { Request, Response, NextFunction } from "express";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const PORT = parseInt(process.env.PORT || "3000", 10);

// Maximum time to wait for a dependency check before considering it failed.
// Prevents a slow database from hanging the entire health endpoint.
const CHECK_TIMEOUT_MS = parseInt(process.env.CHECK_TIMEOUT_MS || "5000", 10);

// App version — typically injected at build time or read from package.json.
const APP_VERSION = process.env.APP_VERSION || "1.0.0";

// ---------------------------------------------------------------------------
// Metrics tracking
// ---------------------------------------------------------------------------
// Simple in-memory metrics. For production, use Prometheus client or similar.

interface Metrics {
  requestCount: number;
  errorCount: number;
  totalResponseTimeMs: number;
  startedAt: Date;
}

const metrics: Metrics = {
  requestCount: 0,
  errorCount: 0,
  totalResponseTimeMs: 0,
  startedAt: new Date(),
};

// ---------------------------------------------------------------------------
// Simulated dependencies
// ---------------------------------------------------------------------------
// In a real app, replace these with actual connection checks.

async function checkPostgres(): Promise<{ ok: boolean; latencyMs: number }> {
  const start = Date.now();
  try {
    // Real implementation:
    // const result = await pool.query("SELECT 1");
    // return { ok: true, latencyMs: Date.now() - start };

    // Simulated: 95% chance healthy, 10-50ms latency
    await new Promise((r) => setTimeout(r, 10 + Math.random() * 40));
    const ok = Math.random() > 0.05;
    return { ok, latencyMs: Date.now() - start };
  } catch {
    return { ok: false, latencyMs: Date.now() - start };
  }
}

async function checkRedis(): Promise<{ ok: boolean; latencyMs: number }> {
  const start = Date.now();
  try {
    // Real implementation:
    // await redis.ping();
    // return { ok: true, latencyMs: Date.now() - start };

    await new Promise((r) => setTimeout(r, 5 + Math.random() * 15));
    const ok = Math.random() > 0.02;
    return { ok, latencyMs: Date.now() - start };
  } catch {
    return { ok: false, latencyMs: Date.now() - start };
  }
}

async function checkExternalAPI(): Promise<{
  ok: boolean;
  latencyMs: number;
}> {
  const start = Date.now();
  try {
    // Real implementation:
    // const res = await fetch("https://api.example.com/health", {
    //   signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
    // });
    // return { ok: res.ok, latencyMs: Date.now() - start };

    await new Promise((r) => setTimeout(r, 20 + Math.random() * 80));
    const ok = Math.random() > 0.1;
    return { ok, latencyMs: Date.now() - start };
  } catch {
    return { ok: false, latencyMs: Date.now() - start };
  }
}

// ---------------------------------------------------------------------------
// Timeout wrapper for dependency checks
// ---------------------------------------------------------------------------
// Wraps a check with a timeout so one slow dependency can't hang the
// entire readiness endpoint. Returns a failed result if the check takes
// longer than CHECK_TIMEOUT_MS.

async function withTimeout<T extends { ok: boolean; latencyMs: number }>(
  check: () => Promise<T>,
  timeoutMs: number = CHECK_TIMEOUT_MS
): Promise<T> {
  return Promise.race([
    check(),
    new Promise<T>((resolve) =>
      setTimeout(
        () => resolve({ ok: false, latencyMs: timeoutMs } as T),
        timeoutMs
      )
    ),
  ]);
}

// ---------------------------------------------------------------------------
// Express app
// ---------------------------------------------------------------------------

const app = express();

// --- Metrics middleware ---
// Tracks request count, error count, and total response time.
// Runs for every request, including health checks.
app.use((req: Request, res: Response, next: NextFunction) => {
  const start = Date.now();
  metrics.requestCount++;

  // The 'finish' event fires when the response has been sent.
  // We use it (not 'close') because 'close' fires even on aborted requests.
  res.on("finish", () => {
    const duration = Date.now() - start;
    metrics.totalResponseTimeMs += duration;

    if (res.statusCode >= 400) {
      metrics.errorCount++;
    }
  });

  next();
});

// ---------------------------------------------------------------------------
// GET /health — Liveness probe
// ---------------------------------------------------------------------------
// Purpose: Is the process alive and responding to HTTP?
// Kubernetes action on failure: Restart the container.
//
// This should be FAST and SIMPLE. Don't check dependencies here.
// If your database is down, the process is still alive — it just can't
// serve traffic (that's what /ready is for).
app.get("/health", (_req: Request, res: Response) => {
  res.status(200).json({
    status: "healthy",
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    version: APP_VERSION,
    pid: process.pid,
  });
});

// ---------------------------------------------------------------------------
// GET /ready — Readiness probe
// ---------------------------------------------------------------------------
// Purpose: Can the app serve real traffic right now?
// Kubernetes action on failure: Remove from load balancer (stop sending traffic).
//
// Checks each dependency independently and reports per-dependency status.
// Returns 200 if ALL critical dependencies are healthy, 503 if any are down.
app.get("/ready", async (_req: Request, res: Response) => {
  // Run all checks concurrently — don't wait for Postgres before checking Redis.
  // Each check has its own timeout so one slow dependency doesn't block others.
  const [postgres, redis, externalAPI] = await Promise.all([
    withTimeout(checkPostgres),
    withTimeout(checkRedis),
    withTimeout(checkExternalAPI),
  ]);

  // Define which dependencies are critical vs optional.
  // A failing external API shouldn't take your entire service offline
  // if you can degrade gracefully.
  const criticalDepsHealthy = postgres.ok && redis.ok;

  const status = criticalDepsHealthy ? "ready" : "not_ready";
  const httpStatus = criticalDepsHealthy ? 200 : 503;

  res.status(httpStatus).json({
    status,
    timestamp: new Date().toISOString(),
    dependencies: {
      postgres: {
        status: postgres.ok ? "up" : "down",
        latencyMs: postgres.latencyMs,
        critical: true,
      },
      redis: {
        status: redis.ok ? "up" : "down",
        latencyMs: redis.latencyMs,
        critical: true,
      },
      externalAPI: {
        status: externalAPI.ok ? "up" : "down",
        latencyMs: externalAPI.latencyMs,
        // Non-critical: app can degrade gracefully without this.
        critical: false,
      },
    },
  });
});

// ---------------------------------------------------------------------------
// GET /startup — Startup probe
// ---------------------------------------------------------------------------
// Purpose: Has the app finished initializing?
// Kubernetes action on failure: Keep waiting (don't restart yet).
//
// Useful for apps with slow startup (loading ML models, warming caches).
// Once this passes, Kubernetes switches to using /health for liveness.
// For simple apps, this can be identical to /health.
app.get("/startup", (_req: Request, res: Response) => {
  // In a real app, check if initialization is complete:
  // - Database migrations have run
  // - Cache is warmed
  // - Config is loaded from remote source
  const initialized = true;

  if (initialized) {
    res.status(200).json({
      status: "started",
      timestamp: new Date().toISOString(),
      pid: process.pid,
    });
  } else {
    res.status(503).json({
      status: "starting",
      timestamp: new Date().toISOString(),
    });
  }
});

// ---------------------------------------------------------------------------
// GET /metrics — Basic application metrics
// ---------------------------------------------------------------------------
// Purpose: Expose operational metrics for monitoring dashboards.
//
// For production, use a proper metrics library (prom-client for Prometheus)
// that supports histograms, gauges, and counters with labels.
// This endpoint provides a simple JSON alternative.
app.get("/metrics", (_req: Request, res: Response) => {
  const uptimeSeconds = process.uptime();
  const memUsage = process.memoryUsage();
  const cpuUsage = process.cpuUsage();

  res.status(200).json({
    timestamp: new Date().toISOString(),
    uptime: {
      seconds: Math.floor(uptimeSeconds),
      human: formatUptime(uptimeSeconds),
    },
    requests: {
      total: metrics.requestCount,
      errors: metrics.errorCount,
      errorRate:
        metrics.requestCount > 0
          ? (metrics.errorCount / metrics.requestCount).toFixed(4)
          : "0.0000",
      avgResponseTimeMs:
        metrics.requestCount > 0
          ? Math.round(metrics.totalResponseTimeMs / metrics.requestCount)
          : 0,
    },
    memory: {
      // RSS (Resident Set Size): total memory allocated for the process
      rss: formatBytes(memUsage.rss),
      // Heap: V8's managed memory for JS objects
      heapUsed: formatBytes(memUsage.heapUsed),
      heapTotal: formatBytes(memUsage.heapTotal),
      // External: memory for C++ objects bound to JS (e.g., Buffers)
      external: formatBytes(memUsage.external),
    },
    cpu: {
      // CPU time in microseconds since process start
      userMicroseconds: cpuUsage.user,
      systemMicroseconds: cpuUsage.system,
    },
  });
});

// ---------------------------------------------------------------------------
// Example application route
// ---------------------------------------------------------------------------
app.get("/", (_req: Request, res: Response) => {
  res.json({ message: "API is running", version: APP_VERSION });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (mins > 0) parts.push(`${mins}m`);
  parts.push(`${secs}s`);
  return parts.join(" ");
}

function formatBytes(bytes: number): string {
  const mb = bytes / 1024 / 1024;
  return `${mb.toFixed(2)} MB`;
}

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------

app.listen(PORT, () => {
  console.log(`Health check server running on port ${PORT}`);
  console.log(`  GET http://localhost:${PORT}/health   — Liveness`);
  console.log(`  GET http://localhost:${PORT}/ready    — Readiness`);
  console.log(`  GET http://localhost:${PORT}/startup  — Startup`);
  console.log(`  GET http://localhost:${PORT}/metrics  — Metrics`);
});
