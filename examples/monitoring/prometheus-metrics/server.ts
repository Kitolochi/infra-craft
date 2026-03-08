// =============================================================================
// Prometheus Metrics Server — Custom Metrics with prom-client
// =============================================================================
// Run: npx tsx server.ts
//
// Endpoints:
//   GET /metrics  — Prometheus scrape endpoint (text/plain)
//   GET /         — Home (generates sample metrics)
//   GET /users    — List users (generates sample metrics)
//   POST /orders  — Create order (generates sample metrics)
//   GET /health   — Health check
//
// Metrics exposed:
//   Default Node.js metrics (CPU, memory, event loop, GC)
//   http_request_duration_seconds     — Histogram: request latency by route
//   http_requests_total               — Counter: total requests by route/status
//   http_active_connections            — Gauge: currently open connections
//   business_events_total             — Counter: domain events (orders, signups)
//   business_order_amount_dollars     — Histogram: order value distribution
//
// Stack: docker compose up (app + Prometheus + Grafana)
// Prometheus UI: http://localhost:9090
// Grafana UI:    http://localhost:3001 (admin/admin)
// =============================================================================

import express, { Request, Response, NextFunction } from "express";
import client from "prom-client";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const PORT = parseInt(process.env.PORT || "3000", 10);

// ---------------------------------------------------------------------------
// Prometheus registry
// ---------------------------------------------------------------------------
// The registry collects all metrics and serializes them for the /metrics
// endpoint. We use the default global registry — prom-client automatically
// registers metrics here unless you create a custom one.
//
// Why a global registry? In most apps, you want a single /metrics endpoint
// that exposes everything. Custom registries are useful when you need
// separate endpoints for different consumers (e.g., internal vs external).

const register = client.register;

// ---------------------------------------------------------------------------
// Default metrics — Node.js runtime stats
// ---------------------------------------------------------------------------
// collectDefaultMetrics() adds standard Node.js metrics automatically:
//   - process_cpu_seconds_total        (CPU usage)
//   - process_resident_memory_bytes    (RSS memory)
//   - nodejs_heap_size_total_bytes     (V8 heap)
//   - nodejs_active_handles_total      (open handles: sockets, timers)
//   - nodejs_eventloop_lag_seconds     (event loop delay)
//   - nodejs_gc_duration_seconds       (garbage collection time)
//
// These are essential for monitoring Node.js health without writing any
// custom code. Grafana has pre-built dashboards for these.

client.collectDefaultMetrics({
  // Prefix all default metrics with "nodejs_" for clear namespacing.
  // Without this, default metrics have no prefix and can collide with
  // other metric names.
  prefix: "nodejs_",
});

// ---------------------------------------------------------------------------
// Custom metric: HTTP request duration (Histogram)
// ---------------------------------------------------------------------------
// Histograms track the distribution of values, not just the average.
// This is critical for latency monitoring — an average of 100ms hides
// the fact that 1% of requests take 5 seconds.
//
// Prometheus calculates percentiles (p50, p95, p99) from histogram buckets.
// The buckets define the boundaries: requests are counted in each bucket
// they fall into (e.g., a 250ms request increments the 0.3, 0.5, 1, ... buckets).
//
// Bucket selection matters:
//   - Too few buckets = imprecise percentiles
//   - Too many buckets = more memory and network overhead
//   - Align buckets with your SLO targets (e.g., "99% of requests under 500ms")

const httpRequestDuration = new client.Histogram({
  name: "http_request_duration_seconds",
  help: "Duration of HTTP requests in seconds",
  labelNames: ["method", "route", "status_code"] as const,
  // Buckets in seconds: 5ms, 10ms, 25ms, 50ms, 100ms, 250ms, 500ms, 1s, 2.5s, 5s, 10s
  // These cover typical API response times. Adjust based on your app:
  // - Fast APIs (cache hits): add more sub-100ms buckets
  // - Slow APIs (ML inference): add 10s, 30s, 60s buckets
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
});

// ---------------------------------------------------------------------------
// Custom metric: Total HTTP requests (Counter)
// ---------------------------------------------------------------------------
// Counters only go up — they count cumulative occurrences.
// Use rate() in PromQL to get requests-per-second:
//   rate(http_requests_total[5m])
//
// Labels let you filter: rate(http_requests_total{status_code="500"}[5m])
// gives you the 500 error rate over the last 5 minutes.
//
// Rule: keep cardinality low. Each unique label combination creates a new
// time series. Using user IDs as labels would create millions of series
// and crash Prometheus.

const httpRequestsTotal = new client.Counter({
  name: "http_requests_total",
  help: "Total number of HTTP requests",
  labelNames: ["method", "route", "status_code"] as const,
});

// ---------------------------------------------------------------------------
// Custom metric: Active connections (Gauge)
// ---------------------------------------------------------------------------
// Gauges can go up and down — they measure current values.
// Perfect for: active connections, queue depth, temperature, cache size.
//
// Unlike counters, gauges show the current state, not the rate of change.
// Use this to detect connection leaks (gauge keeps climbing without dropping)
// or to set alerts when connections exceed capacity.

const activeConnections = new client.Gauge({
  name: "http_active_connections",
  help: "Number of active HTTP connections currently being processed",
});

// ---------------------------------------------------------------------------
// Custom metric: Business events (Counter)
// ---------------------------------------------------------------------------
// Track domain-specific events alongside infrastructure metrics.
// Correlating business metrics with system metrics is powerful:
//   "Orders dropped 50% at the same time p99 latency spiked"
//
// Keep it simple: count events by type. Detailed analytics belong in
// your analytics platform (Mixpanel, Amplitude), not Prometheus.

const businessEvents = new client.Counter({
  name: "business_events_total",
  help: "Total business domain events",
  labelNames: ["event_type"] as const,
});

// ---------------------------------------------------------------------------
// Custom metric: Order amount distribution (Histogram)
// ---------------------------------------------------------------------------
// Track the distribution of order values, not just the count.
// Useful for detecting anomalies: "average order value dropped by 30%"
// or "we're getting unusually many high-value orders" (fraud signal).

const orderAmount = new client.Histogram({
  name: "business_order_amount_dollars",
  help: "Distribution of order amounts in dollars",
  labelNames: ["currency"] as const,
  buckets: [1, 5, 10, 25, 50, 100, 250, 500, 1000, 5000],
});

// ---------------------------------------------------------------------------
// Express app
// ---------------------------------------------------------------------------

const app = express();
app.use(express.json());

// ---------------------------------------------------------------------------
// Middleware: Track request duration and count
// ---------------------------------------------------------------------------
// This middleware wraps every request to record timing and status.
// It runs before route handlers (to start the timer) and hooks into
// the response "finish" event (to record the final duration and status).

app.use((req: Request, res: Response, next: NextFunction) => {
  // Increment active connections when a request starts.
  activeConnections.inc();

  // Start a high-resolution timer.
  // process.hrtime.bigint() gives nanosecond precision — more accurate
  // than Date.now() for sub-millisecond measurements.
  const startTime = process.hrtime.bigint();

  // The "finish" event fires when the response has been fully sent.
  // We record the duration and status code here, after the route handler
  // has set the status and written the body.
  res.on("finish", () => {
    activeConnections.dec();

    const endTime = process.hrtime.bigint();
    const durationSeconds = Number(endTime - startTime) / 1e9;

    // Normalize the route to prevent label explosion.
    // Without this, /users/1, /users/2, /users/3 would each create
    // a separate time series. We want /users/:id as a single series.
    const route = normalizeRoute(req.route?.path || req.path, req.method);

    const labels = {
      method: req.method,
      route,
      status_code: res.statusCode.toString(),
    };

    httpRequestDuration.observe(labels, durationSeconds);
    httpRequestsTotal.inc(labels);
  });

  next();
});

// ---------------------------------------------------------------------------
// GET /metrics — Prometheus scrape endpoint
// ---------------------------------------------------------------------------
// This is where Prometheus fetches metrics. It scrapes this endpoint
// every 15 seconds (configured in prometheus.yml).
//
// The response format is Prometheus exposition format (text/plain):
//   # HELP http_requests_total Total number of HTTP requests
//   # TYPE http_requests_total counter
//   http_requests_total{method="GET",route="/",status_code="200"} 42
//
// Don't add authentication to this endpoint if Prometheus is on the same
// network. If it's external, use basic auth or a reverse proxy.

app.get("/metrics", async (_req: Request, res: Response) => {
  try {
    res.set("Content-Type", register.contentType);
    res.end(await register.metrics());
  } catch {
    res.status(500).end("Error collecting metrics");
  }
});

// ---------------------------------------------------------------------------
// GET / — Home
// ---------------------------------------------------------------------------
app.get("/", (_req: Request, res: Response) => {
  res.json({ message: "API is running", version: "1.0.0" });
});

// ---------------------------------------------------------------------------
// GET /users — List users (simulated)
// ---------------------------------------------------------------------------
app.get("/users", async (_req: Request, res: Response) => {
  // Simulated DB latency
  await new Promise((r) => setTimeout(r, 30 + Math.random() * 70));

  const users = [
    { id: 1, name: "Alice", email: "alice@example.com" },
    { id: 2, name: "Bob", email: "bob@example.com" },
  ];

  res.json({ users });
});

// ---------------------------------------------------------------------------
// POST /orders — Create order (with business metrics)
// ---------------------------------------------------------------------------
app.post("/orders", async (req: Request, res: Response) => {
  const amount = req.body.amount || Math.random() * 200;
  const currency = req.body.currency || "USD";

  // Simulated processing
  await new Promise((r) => setTimeout(r, 50 + Math.random() * 150));

  // Record business event and order amount.
  // These metrics correlate business activity with system performance.
  businessEvents.inc({ event_type: "order_created" });
  orderAmount.observe({ currency }, amount);

  res.status(201).json({
    orderId: `ord_${Date.now()}`,
    amount,
    currency,
    status: "created",
  });
});

// ---------------------------------------------------------------------------
// GET /health — Health check
// ---------------------------------------------------------------------------
app.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "healthy", uptime: process.uptime() });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Normalize Express route paths to prevent label cardinality explosion.
// /users/123 → /users/:id, /orders/abc/items/456 → /orders/:id/items/:id
// This keeps the number of unique time series manageable.
function normalizeRoute(path: string, method: string): string {
  if (!path || path === "/") return "/";

  // If Express matched a route pattern (e.g., /users/:id), use that.
  // req.route.path gives the pattern, not the actual URL.
  if (path.includes(":")) return path;

  // Fallback: replace numeric segments with :id.
  // This handles cases where req.route is undefined (404s, middleware-only routes).
  return path.replace(/\/\d+/g, "/:id");
}

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------

app.listen(PORT, () => {
  console.log(`Prometheus metrics server running on port ${PORT}`);
  console.log(`  GET  http://localhost:${PORT}/metrics — Prometheus scrape endpoint`);
  console.log(`  GET  http://localhost:${PORT}/        — Home`);
  console.log(`  GET  http://localhost:${PORT}/users   — List users`);
  console.log(`  POST http://localhost:${PORT}/orders  — Create order`);
  console.log(`  GET  http://localhost:${PORT}/health  — Health check`);
  console.log("");
  console.log("Prometheus UI: http://localhost:9090");
  console.log("Grafana UI:    http://localhost:3001 (admin/admin)");
});
