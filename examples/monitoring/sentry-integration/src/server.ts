// =============================================================================
// Sentry Integration — Error Tracking and Performance Monitoring
// =============================================================================
// Run: npx tsx src/server.ts
//
// This example demonstrates:
//   1. @sentry/node initialization with Express integration
//   2. @sentry/profiling-node for continuous CPU profiling
//   3. Express error handler middleware for automatic error capture
//   4. Transaction and span creation for performance monitoring
//   5. Custom context: user info, request metadata, breadcrumbs
//   6. Environment-based DSN and sample rates
//   7. Source map configuration notes for production debugging
//
// Endpoints:
//   GET  /                — Home (auto-instrumented)
//   GET  /users           — List users (custom span + breadcrumbs)
//   GET  /users/:id       — Get user (user context + scope)
//   POST /orders          — Create order (nested spans + custom data)
//   GET  /error           — Deliberate error (captured by Sentry)
//   GET  /health          — Health check (excluded from tracing)
//
// Setup:
//   1. Create a Sentry project at https://sentry.io
//   2. Set SENTRY_DSN environment variable to your project's DSN
//   3. Sentry captures errors and performance data automatically
//
// Source Maps (production):
//   For readable stack traces in production, upload source maps to Sentry:
//     1. Enable "sourceMap": true in tsconfig.json
//     2. Install @sentry/cli: npm i -D @sentry/cli
//     3. After build, upload maps:
//        npx sentry-cli sourcemaps upload --release=<version> ./dist
//     4. Add release to Sentry.init({ release: "my-app@1.0.0" })
//     5. Delete .map files from deployment (don't serve them to clients)
//   Without source maps, Sentry shows minified/compiled stack traces
//   that are nearly impossible to debug.
// =============================================================================

import * as Sentry from "@sentry/node";
import { nodeProfilingIntegration } from "@sentry/profiling-node";
import express, { Request, Response, NextFunction } from "express";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const PORT = parseInt(process.env.PORT || "3000", 10);
const NODE_ENV = process.env.NODE_ENV || "development";

// The DSN (Data Source Name) tells the SDK where to send events.
// Format: https://<public_key>@<host>/<project_id>
// Never hardcode this — use environment variables. The DSN is not secret
// (it's in client-side JS for frontend apps), but it should still be
// configurable per environment.
const SENTRY_DSN = process.env.SENTRY_DSN || "";

// ---------------------------------------------------------------------------
// Sentry initialization
// ---------------------------------------------------------------------------
// IMPORTANT: Sentry.init() must be called BEFORE importing other modules
// that you want to instrument. In production, put this in a separate file
// (e.g., instrument.ts) loaded via --require or --import flag:
//   node --import ./instrument.mjs dist/server.js
//
// For this example, we initialize inline since everything is in one file.

Sentry.init({
  dsn: SENTRY_DSN,

  // Environment tag — filters events in the Sentry dashboard.
  // Typically: development, staging, production.
  environment: NODE_ENV,

  // Release tag — ties errors to specific deployments.
  // Use your build version, git SHA, or semantic version.
  // This enables: "Was this error introduced in v2.3.1?"
  release: `sentry-example@${process.env.APP_VERSION || "1.0.0"}`,

  // ---------------------------------------------------------------------------
  // Performance monitoring (tracing)
  // ---------------------------------------------------------------------------
  // tracesSampleRate: percentage of transactions to capture (0.0 to 1.0).
  //   - 1.0 = capture 100% (development/staging)
  //   - 0.1 = capture 10% (production with moderate traffic)
  //   - 0.01 = capture 1% (high-traffic production)
  //
  // Why not always 100%? Each transaction sends data to Sentry, which
  // costs money and adds network overhead. At 10k requests/second,
  // 100% sampling generates 864M events/day.
  tracesSampleRate: NODE_ENV === "production" ? 0.1 : 1.0,

  // ---------------------------------------------------------------------------
  // Continuous profiling
  // ---------------------------------------------------------------------------
  // Profiles show which functions consume CPU time during a transaction.
  // This helps find: "The /orders endpoint is slow because JSON.parse
  // takes 200ms on large payloads."
  //
  // profilesSampleRate is relative to tracesSampleRate:
  //   tracesSampleRate=0.1 + profilesSampleRate=0.5 = 5% of requests profiled.
  profilesSampleRate: NODE_ENV === "production" ? 0.5 : 1.0,

  integrations: [
    // CPU profiling — requires @sentry/profiling-node.
    // Adds ~1-2% CPU overhead. Safe for production at low sample rates.
    nodeProfilingIntegration(),
  ],

  // ---------------------------------------------------------------------------
  // Data scrubbing
  // ---------------------------------------------------------------------------
  // Sentry captures a lot of context by default. Use beforeSend to strip
  // sensitive data before it leaves your server.

  beforeSend(event) {
    // Remove sensitive headers from request data.
    if (event.request?.headers) {
      delete event.request.headers["authorization"];
      delete event.request.headers["cookie"];
      delete event.request.headers["x-api-key"];
    }

    // Remove sensitive data from request body.
    if (event.request?.data && typeof event.request.data === "object") {
      const data = event.request.data as Record<string, unknown>;
      if (data.password) data.password = "[REDACTED]";
      if (data.creditCard) data.creditCard = "[REDACTED]";
      if (data.ssn) data.ssn = "[REDACTED]";
    }

    return event;
  },

  // beforeSendTransaction works the same way but for performance data.
  // Use it to drop noisy transactions (health checks, metrics scrapes).
  beforeSendTransaction(event) {
    if (event.transaction === "GET /health") return null;
    return event;
  },
});

// ---------------------------------------------------------------------------
// Express app
// ---------------------------------------------------------------------------

const app = express();
app.use(express.json());

// ---------------------------------------------------------------------------
// GET / — Home (auto-instrumented)
// ---------------------------------------------------------------------------
// Sentry's Express integration automatically creates a transaction for
// every incoming request. The transaction captures:
//   - HTTP method, URL, status code
//   - Response time
//   - Express route pattern
// No manual code needed for basic request tracing.

app.get("/", (_req: Request, res: Response) => {
  res.json({ message: "Sentry integration example", version: "1.0.0" });
});

// ---------------------------------------------------------------------------
// GET /users — List users (custom spans + breadcrumbs)
// ---------------------------------------------------------------------------
// Demonstrates adding custom spans within an auto-instrumented transaction,
// and using breadcrumbs to leave a trail of what happened before an error.

app.get("/users", async (_req: Request, res: Response) => {
  // Breadcrumbs are trail markers that appear in error reports.
  // When an error occurs later, Sentry shows the last ~100 breadcrumbs,
  // helping you understand what the app was doing before the crash.
  Sentry.addBreadcrumb({
    category: "query",
    message: "Fetching user list from database",
    level: "info",
    data: { table: "users", limit: 100 },
  });

  // startSpan creates a child span within the current transaction.
  // The transaction was auto-created by Sentry's Express integration.
  // This span isolates the "database query" timing from Express overhead.
  const users = await Sentry.startSpan(
    {
      name: "db.query.users",
      op: "db.query",
      attributes: {
        "db.system": "postgresql",
        "db.statement": "SELECT * FROM users LIMIT 100",
      },
    },
    async () => {
      // Simulated database query.
      await new Promise((r) => setTimeout(r, 40 + Math.random() * 80));

      return [
        { id: 1, name: "Alice", email: "alice@example.com" },
        { id: 2, name: "Bob", email: "bob@example.com" },
        { id: 3, name: "Carol", email: "carol@example.com" },
      ];
    }
  );

  Sentry.addBreadcrumb({
    category: "query",
    message: `Found ${users.length} users`,
    level: "info",
  });

  res.json({ users });
});

// ---------------------------------------------------------------------------
// GET /users/:id — Get user (user context + scope)
// ---------------------------------------------------------------------------
// Demonstrates setting user context so errors are associated with specific
// users in the Sentry dashboard. This enables: "How many users are affected
// by this error?" and "Show me all errors for user alice@example.com."

app.get("/users/:id", async (req: Request, res: Response) => {
  const userId = parseInt(req.params.id, 10);

  // Set user context on the current scope.
  // This is scoped to the current request — it doesn't leak to other requests.
  // Fields: id (required), email, username, ip_address.
  // Don't add PII you don't need for debugging.
  Sentry.setUser({
    id: userId.toString(),
    username: `user_${userId}`,
  });

  // setTag adds searchable key-value pairs.
  // Use tags for high-cardinality data you want to filter by:
  //   "Show me all errors where feature_flag:new_checkout = true"
  Sentry.setTag("user.tier", userId % 2 === 0 ? "premium" : "free");

  // setContext adds structured data that appears in the event detail view.
  // Unlike tags, context is not searchable — use it for debugging details.
  Sentry.setContext("request_metadata", {
    userAgent: req.headers["user-agent"],
    acceptLanguage: req.headers["accept-language"],
    referer: req.headers.referer,
  });

  const user = await Sentry.startSpan(
    { name: "db.query.user_by_id", op: "db.query" },
    async () => {
      await new Promise((r) => setTimeout(r, 20 + Math.random() * 40));

      if (userId % 2 !== 0) return null;
      return { id: userId, name: "Alice", email: "alice@example.com" };
    }
  );

  if (!user) {
    Sentry.addBreadcrumb({
      category: "navigation",
      message: `User ${userId} not found`,
      level: "warning",
    });
    return res.status(404).json({ error: "User not found" });
  }

  res.json({ user });
});

// ---------------------------------------------------------------------------
// POST /orders — Create order (nested spans + custom data)
// ---------------------------------------------------------------------------
// Demonstrates nested spans for multi-step operations. Each step gets its
// own span, making it easy to find bottlenecks in the Sentry performance
// waterfall view.

app.post("/orders", async (req: Request, res: Response) => {
  const amount = req.body.amount || Math.round(Math.random() * 500);
  const currency = req.body.currency || "USD";

  // Wrap the entire order flow in a custom span.
  const result = await Sentry.startSpan(
    {
      name: "order.create",
      op: "business.logic",
      attributes: { "order.amount": amount, "order.currency": currency },
    },
    async () => {
      // Step 1: Validate order.
      await Sentry.startSpan(
        { name: "order.validate", op: "validation" },
        async () => {
          await new Promise((r) => setTimeout(r, 10));
          Sentry.addBreadcrumb({
            category: "order",
            message: "Order validation passed",
            level: "info",
          });
        }
      );

      // Step 2: Process payment.
      await Sentry.startSpan(
        {
          name: "payment.charge",
          op: "http.client",
          attributes: {
            "payment.provider": "stripe",
            "payment.amount_cents": amount * 100,
          },
        },
        async () => {
          await new Promise((r) => setTimeout(r, 80 + Math.random() * 150));
          Sentry.addBreadcrumb({
            category: "payment",
            message: `Payment processed: ${amount} ${currency}`,
            level: "info",
            data: { provider: "stripe", transactionId: `txn_${Date.now()}` },
          });
        }
      );

      // Step 3: Save to database.
      await Sentry.startSpan(
        { name: "db.insert.order", op: "db.query" },
        async () => {
          await new Promise((r) => setTimeout(r, 25 + Math.random() * 50));
        }
      );

      return {
        orderId: `ord_${Date.now()}`,
        amount,
        currency,
        status: "created",
      };
    }
  );

  res.status(201).json(result);
});

// ---------------------------------------------------------------------------
// GET /error — Deliberate error for Sentry capture
// ---------------------------------------------------------------------------
// Throws an error that the Sentry error handler catches. This appears in
// the Sentry Issues dashboard with full context: stack trace, breadcrumbs,
// user info, request data, and the trace that led to it.

app.get("/error", (_req: Request, res: Response) => {
  Sentry.addBreadcrumb({
    category: "debug",
    message: "About to simulate a critical error",
    level: "warning",
  });

  // Throwing inside a route handler is caught by Sentry's error middleware.
  // For async handlers, unhandled rejections are also captured automatically.
  throw new Error("Simulated critical failure — this is a test error");
});

// ---------------------------------------------------------------------------
// GET /health — Health check (excluded from tracing)
// ---------------------------------------------------------------------------
app.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "healthy", uptime: process.uptime() });
});

// ---------------------------------------------------------------------------
// Sentry error handler
// ---------------------------------------------------------------------------
// MUST be registered after all routes but before any other error handlers.
// This middleware catches errors thrown in route handlers and sends them
// to Sentry with full request context (URL, headers, body, user).
//
// It does NOT send a response — your own error handler (below) does that.
// Sentry just records the error and passes it through with next(err).

Sentry.setupExpressErrorHandler(app);

// ---------------------------------------------------------------------------
// Application error handler
// ---------------------------------------------------------------------------
// Sends the actual HTTP response after Sentry has captured the error.
// Sentry's handler calls next(err), which reaches this middleware.

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  const eventId = Sentry.lastEventId();

  res.status(500).json({
    error: "Internal server error",
    // Include the Sentry event ID so users can reference it in support tickets.
    // "I got error abc123" → search Sentry for that event ID.
    ...(eventId && { sentryEventId: eventId }),
  });
});

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------
// Flush pending events before the process exits. Without this, errors
// captured just before shutdown may be lost because Sentry batches events
// and sends them asynchronously.

async function shutdown(signal: string) {
  console.log(`${signal} received — flushing Sentry events...`);
  await Sentry.close(5000);
  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------

app.listen(PORT, () => {
  console.log(`Sentry integration server running on port ${PORT}`);
  console.log(`  GET  http://localhost:${PORT}/          — Home`);
  console.log(`  GET  http://localhost:${PORT}/users     — List users`);
  console.log(`  GET  http://localhost:${PORT}/users/2   — Get user`);
  console.log(`  POST http://localhost:${PORT}/orders    — Create order`);
  console.log(`  GET  http://localhost:${PORT}/error     — Trigger error`);
  console.log(`  GET  http://localhost:${PORT}/health    — Health check`);
  console.log("");
  console.log(`Sentry DSN: ${SENTRY_DSN ? "configured" : "NOT SET (events will be dropped)"}`);
  console.log(`Environment: ${NODE_ENV}`);
  console.log(`Traces sample rate: ${NODE_ENV === "production" ? "10%" : "100%"}`);
});
