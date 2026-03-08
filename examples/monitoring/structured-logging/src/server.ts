// =============================================================================
// Structured Logging with Pino — Request Correlation and Child Loggers
// =============================================================================
// Run: npx tsx src/server.ts
// Dev: LOG_PRETTY=true npx tsx watch src/server.ts
//
// This example demonstrates:
//   1. Pino logger setup with environment-based configuration
//   2. Request ID generation and propagation via X-Request-ID header
//   3. All six log levels: trace, debug, info, warn, error, fatal
//   4. Child loggers that carry context (userId, requestId, module)
//   5. Request correlation: start → processing → response with same requestId
//   6. Pretty-print for development, JSON for production
//
// Endpoints:
//   GET  /                — Home (basic logging)
//   GET  /users           — List users (child logger with module context)
//   GET  /users/:id       — Get user (warn on not found, error simulation)
//   POST /orders          — Create order (correlated multi-step logging)
//   GET  /health          — Health check (trace-level, filtered in production)
//   GET  /error           — Deliberate error (error + fatal level demo)
//
// Why structured logging?
//   Plain text logs like "User 42 created order" are human-readable but
//   impossible to query at scale. Structured JSON logs let you:
//     - Filter: jq '.level == "error"' or Datadog query level:error
//     - Correlate: find all logs for requestId "abc-123" across services
//     - Alert: trigger PagerDuty when error count exceeds threshold
//     - Analyze: count orders per userId, measure p99 response times
//
// Why Pino?
//   Pino is the fastest Node.js logger (~5x faster than Winston/Bunyan).
//   It achieves this by writing JSON directly without intermediate objects.
//   Child loggers are cheap — they share the parent's stream and just
//   merge additional context fields into each log line.
// =============================================================================

import express, { Request, Response, NextFunction } from "express";
import pino from "pino";
import pinoHttp from "pino-http";
import { v4 as uuidv4 } from "uuid";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const PORT = parseInt(process.env.PORT || "3000", 10);
const LOG_LEVEL = process.env.LOG_LEVEL || "info";
const LOG_PRETTY = process.env.LOG_PRETTY === "true";
const NODE_ENV = process.env.NODE_ENV || "development";

// ---------------------------------------------------------------------------
// Logger setup
// ---------------------------------------------------------------------------
// Pino outputs one JSON object per log line. Each line includes:
//   - level: numeric level (10=trace, 20=debug, 30=info, 40=warn, 50=error, 60=fatal)
//   - time: epoch milliseconds (parsed by log aggregators)
//   - msg: the log message
//   - ...any additional context fields you add
//
// In production, pipe JSON to your log aggregator (Datadog, ELK, Loki).
// In development, pipe through pino-pretty for colored, human-readable output.

const logger = pino({
  // Log level hierarchy: trace < debug < info < warn < error < fatal.
  // Setting level to "info" silences trace and debug logs.
  // In production, use "info" or "warn" to reduce log volume.
  // In development, use "debug" or "trace" for maximum visibility.
  level: LOG_LEVEL,

  // Base context — these fields appear in every log line from this logger.
  // Use them for service-level metadata that helps filter in log aggregators.
  base: {
    service: "structured-logging-example",
    env: NODE_ENV,
    pid: process.pid,
  },

  // Timestamp format: ISO string for human readability, epoch for performance.
  // Pino uses epoch by default (fastest). ISO is ~10% slower but much easier
  // to read in development and some log aggregators prefer it.
  timestamp: pino.stdTimeFunctions.isoTime,

  // Pretty-print in development for readable console output.
  // In production, raw JSON goes to stdout for log aggregators.
  // Never use pino-pretty in production — it's 10x slower than raw JSON.
  ...(LOG_PRETTY && {
    transport: {
      target: "pino-pretty",
      options: {
        colorize: true,
        translateTime: "SYS:HH:MM:ss.l",
        ignore: "pid,hostname",
      },
    },
  }),
});

// ---------------------------------------------------------------------------
// Child loggers
// ---------------------------------------------------------------------------
// Child loggers inherit the parent's configuration and stream, but add
// extra context fields to every log line. They're extremely cheap to create
// (no new streams or file handles) — create them freely per-module or
// per-request.
//
// Pattern: create module-level children for static context, and per-request
// children for dynamic context (requestId, userId).

const dbLogger = logger.child({ module: "database" });
const orderLogger = logger.child({ module: "orders" });

// ---------------------------------------------------------------------------
// Request ID middleware
// ---------------------------------------------------------------------------
// Generates a unique ID for each request and propagates it through:
//   1. Response header (X-Request-ID) — so clients can reference it in support tickets
//   2. Request object — so route handlers can access it
//   3. Child logger — so every log line in this request includes the ID
//
// If the client sends X-Request-ID, we reuse it. This enables end-to-end
// tracing across API gateway → service A → service B, all sharing one ID.

function requestIdMiddleware(req: Request, res: Response, next: NextFunction) {
  const requestId = (req.headers["x-request-id"] as string) || uuidv4();

  // Attach to request for downstream access.
  (req as any).requestId = requestId;

  // Echo back in response so the caller can correlate.
  res.setHeader("X-Request-ID", requestId);

  next();
}

// ---------------------------------------------------------------------------
// Pino HTTP middleware
// ---------------------------------------------------------------------------
// pino-http automatically logs every request/response pair with:
//   - HTTP method, URL, status code, response time
//   - Request ID (via genReqId)
//   - Request headers (redacted by default in production)
//
// It creates a per-request child logger at req.log, which you can use in
// route handlers. Every log line from req.log includes the requestId.

const httpLogger = pinoHttp({
  logger,

  // Use the request ID we generated (or received from the client).
  genReqId: (req) => (req as any).requestId || uuidv4(),

  // Customize the automatic request/response log message.
  // Default is "request completed" — we add method and URL for grep-ability.
  customSuccessMessage: (req, res) => {
    return `${req.method} ${req.url} completed`;
  },
  customErrorMessage: (req, res, err) => {
    return `${req.method} ${req.url} failed`;
  },

  // Control which requests get which log level.
  // 4xx = warn (client errors, not our fault but worth tracking),
  // 5xx = error (server errors, investigate immediately).
  customLogLevel: (_req, res, err) => {
    if (res.statusCode >= 500 || err) return "error";
    if (res.statusCode >= 400) return "warn";
    return "info";
  },

  // Redact sensitive headers in production.
  // Authorization tokens, cookies, and API keys should never appear in logs.
  serializers: {
    req: (req) => ({
      id: req.id,
      method: req.method,
      url: req.url,
      headers: {
        host: req.headers.host,
        "user-agent": req.headers["user-agent"],
        "content-type": req.headers["content-type"],
        "x-request-id": req.headers["x-request-id"],
        // Intentionally omitting: authorization, cookie, x-api-key
      },
    }),
    res: (res) => ({
      statusCode: res.statusCode,
    }),
  },

  // Skip logging for health checks in production to reduce noise.
  // Health probes from Kubernetes fire every 10 seconds — that's 8,640
  // log lines per day per pod for zero diagnostic value.
  autoLogging: {
    ignore: (req) => {
      if (NODE_ENV === "production" && req.url === "/health") return true;
      return false;
    },
  },
});

// ---------------------------------------------------------------------------
// Express app
// ---------------------------------------------------------------------------

const app = express();
app.use(express.json());
app.use(requestIdMiddleware);
app.use(httpLogger);

// ---------------------------------------------------------------------------
// GET / — Home (basic logging)
// ---------------------------------------------------------------------------
app.get("/", (req: Request, res: Response) => {
  // req.log is the per-request child logger created by pino-http.
  // It automatically includes the requestId in every log line.
  req.log.info("Home page requested");

  res.json({
    message: "Structured logging example",
    requestId: (req as any).requestId,
  });
});

// ---------------------------------------------------------------------------
// GET /users — List users (module-scoped child logger)
// ---------------------------------------------------------------------------
app.get("/users", async (req: Request, res: Response) => {
  const requestId = (req as any).requestId;

  // Create a request-scoped child of the module logger.
  // This log line includes both module:"database" AND requestId.
  const log = dbLogger.child({ requestId });

  log.info("Querying users from database");
  log.debug({ query: "SELECT * FROM users LIMIT 100" }, "Executing SQL query");

  // Simulated database latency.
  const start = Date.now();
  await new Promise((r) => setTimeout(r, 30 + Math.random() * 70));
  const durationMs = Date.now() - start;

  const users = [
    { id: 1, name: "Alice", role: "admin" },
    { id: 2, name: "Bob", role: "user" },
    { id: 3, name: "Carol", role: "user" },
  ];

  log.info(
    { resultCount: users.length, durationMs },
    "Users query completed"
  );

  res.json({ users, requestId });
});

// ---------------------------------------------------------------------------
// GET /users/:id — Get user (warn on not found, error simulation)
// ---------------------------------------------------------------------------
app.get("/users/:id", async (req: Request, res: Response) => {
  const userId = parseInt(req.params.id, 10);
  const requestId = (req as any).requestId;
  const log = dbLogger.child({ requestId, userId });

  log.info("Looking up user by ID");

  // Simulated database query.
  await new Promise((r) => setTimeout(r, 15 + Math.random() * 35));

  // Simulate: ID 999 triggers an error, odd IDs not found.
  if (userId === 999) {
    log.error(
      { err: new Error("Connection refused"), dbHost: "postgres-primary" },
      "Database connection failed during user lookup"
    );
    return res.status(500).json({ error: "Internal server error", requestId });
  }

  if (userId % 2 !== 0) {
    // Warn level: not an error in our code, but worth tracking.
    // High rates of 404s might indicate a broken client or a scraper.
    log.warn({ userId }, "User not found");
    return res.status(404).json({ error: "User not found", requestId });
  }

  log.info({ userId, role: "admin" }, "User found");
  res.json({
    user: { id: userId, name: "Alice", role: "admin" },
    requestId,
  });
});

// ---------------------------------------------------------------------------
// POST /orders — Create order (correlated multi-step logging)
// ---------------------------------------------------------------------------
// This demonstrates the core value of request ID correlation: you can follow
// a single order through validation → payment → fulfillment in your log
// aggregator by filtering on requestId.
//
// In production, these steps might span multiple services. The requestId
// (propagated via X-Request-ID header) ties them all together.

app.post("/orders", async (req: Request, res: Response) => {
  const requestId = (req as any).requestId;
  const log = orderLogger.child({ requestId });

  const amount = req.body.amount || Math.round(Math.random() * 500);
  const currency = req.body.currency || "USD";
  const orderId = `ord_${Date.now()}`;

  // Step 1: Log order received with full context.
  log.info(
    { orderId, amount, currency, step: "received" },
    "Order received — starting processing"
  );

  // Step 2: Validate.
  log.debug({ orderId, step: "validation" }, "Validating order data");
  await new Promise((r) => setTimeout(r, 10));

  if (amount <= 0) {
    log.warn(
      { orderId, amount, step: "validation" },
      "Order rejected — invalid amount"
    );
    return res.status(400).json({ error: "Invalid amount", requestId });
  }

  // Step 3: Process payment.
  log.info(
    { orderId, amount, currency, step: "payment" },
    "Processing payment"
  );
  await new Promise((r) => setTimeout(r, 80 + Math.random() * 120));

  // Step 4: Save to database.
  log.info({ orderId, step: "persistence" }, "Saving order to database");
  await new Promise((r) => setTimeout(r, 20 + Math.random() * 40));

  // Step 5: Log completion with timing.
  log.info(
    { orderId, amount, currency, step: "completed" },
    "Order created successfully"
  );

  res.status(201).json({ orderId, amount, currency, status: "created", requestId });
});

// ---------------------------------------------------------------------------
// GET /health — Health check (trace level)
// ---------------------------------------------------------------------------
// Health checks use trace level — the lowest priority. In production with
// LOG_LEVEL=info, these are silenced automatically. In development with
// LOG_LEVEL=trace, you see them for debugging.

app.get("/health", (req: Request, res: Response) => {
  req.log.trace("Health check requested");
  res.json({ status: "healthy", uptime: process.uptime() });
});

// ---------------------------------------------------------------------------
// GET /error — Deliberate error (error + fatal level demo)
// ---------------------------------------------------------------------------
// Demonstrates error and fatal log levels with proper error serialization.
// Pino serializes Error objects automatically, capturing message, stack,
// and any custom properties.

app.get("/error", (req: Request, res: Response) => {
  const requestId = (req as any).requestId;
  const log = logger.child({ requestId });

  // Error level: something went wrong with this request, but the server
  // can continue handling other requests.
  const simulatedError = new Error("Simulated database timeout");
  (simulatedError as any).code = "ETIMEDOUT";
  (simulatedError as any).dbHost = "postgres-replica-2";

  log.error(
    { err: simulatedError },
    "Request failed due to database timeout"
  );

  res.status(500).json({ error: "Internal server error", requestId });
});

// ---------------------------------------------------------------------------
// Global error handler
// ---------------------------------------------------------------------------
// Catches unhandled errors from route handlers. Logs the full error with
// request context so you can reproduce and fix the issue.

app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
  req.log.error(
    { err, requestId: (req as any).requestId },
    "Unhandled error in request pipeline"
  );
  res.status(500).json({ error: "Internal server error" });
});

// ---------------------------------------------------------------------------
// Process-level error handlers
// ---------------------------------------------------------------------------
// These catch errors that escape Express entirely. Log at fatal level
// because the process is about to crash — this is the last thing in the logs.

process.on("uncaughtException", (err) => {
  logger.fatal({ err }, "Uncaught exception — process will exit");
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  logger.fatal({ err: reason }, "Unhandled promise rejection — process will exit");
  process.exit(1);
});

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------

app.listen(PORT, () => {
  logger.info(
    { port: PORT, logLevel: LOG_LEVEL, pretty: LOG_PRETTY, env: NODE_ENV },
    "Server started"
  );
  console.log(`Structured logging server running on port ${PORT}`);
  console.log(`  GET  http://localhost:${PORT}/          — Home`);
  console.log(`  GET  http://localhost:${PORT}/users     — List users`);
  console.log(`  GET  http://localhost:${PORT}/users/2   — Get user`);
  console.log(`  GET  http://localhost:${PORT}/users/3   — User not found`);
  console.log(`  POST http://localhost:${PORT}/orders    — Create order`);
  console.log(`  GET  http://localhost:${PORT}/health    — Health check`);
  console.log(`  GET  http://localhost:${PORT}/error     — Error demo`);
  console.log("");
  console.log(`Log level: ${LOG_LEVEL} | Pretty: ${LOG_PRETTY}`);
  console.log("Tip: LOG_PRETTY=true for colored dev output");
});
