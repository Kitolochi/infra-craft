// =============================================================================
// Express Server with Custom OpenTelemetry Spans
// =============================================================================
// Run: npx tsx tracing.ts
//      (tracing.ts initializes OpenTelemetry, then this server starts)
//
// This file demonstrates:
//   1. Auto-instrumented Express routes (no manual code needed)
//   2. Custom spans for business logic
//   3. Adding attributes to spans for debugging
//   4. Trace context propagation across services
//   5. Error recording on spans
//
// Endpoints:
//   GET  /                — Home (auto-instrumented)
//   GET  /users           — List users (custom span for DB query)
//   GET  /users/:id       — Get user (custom span + attributes)
//   POST /orders          — Create order (nested custom spans)
//   GET  /external        — Calls external API (context propagation demo)
//   GET  /health          — Health check (excluded from traces)
// =============================================================================

// IMPORTANT: tracing.ts must be imported first. It patches express and http
// at import time. If we imported express before tracing, requests wouldn't
// generate spans.
import "./tracing.js";

import express, { Request, Response } from "express";
import { trace, SpanStatusCode, SpanKind, context } from "@opentelemetry/api";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const PORT = parseInt(process.env.PORT || "3000", 10);

// ---------------------------------------------------------------------------
// Get a tracer instance
// ---------------------------------------------------------------------------
// A tracer creates spans. The name identifies where spans came from in the
// Jaeger UI — use your service or module name.
// The version helps correlate traces with specific deployments.

const tracer = trace.getTracer("my-api", "1.0.0");

// ---------------------------------------------------------------------------
// Express app
// ---------------------------------------------------------------------------

const app = express();
app.use(express.json());

// ---------------------------------------------------------------------------
// GET / — Auto-instrumented route
// ---------------------------------------------------------------------------
// OpenTelemetry auto-instrumentation creates a span for this route
// automatically. No manual trace code needed. The span will show:
//   - HTTP method, URL, status code
//   - Response time
//   - Express route pattern ("/")

app.get("/", (_req: Request, res: Response) => {
  res.json({ message: "API is running", version: "1.0.0" });
});

// ---------------------------------------------------------------------------
// GET /users — Custom span for database query
// ---------------------------------------------------------------------------
// Auto-instrumentation captures the Express route, but we add a custom span
// to isolate the "database query" portion. This makes it visible in the
// trace waterfall: how much time was Express overhead vs. DB time?

app.get("/users", async (_req: Request, res: Response) => {
  // tracer.startActiveSpan() creates a span and sets it as the "active" span.
  // Any spans created inside this callback automatically become children of
  // this span, building the trace hierarchy.
  await tracer.startActiveSpan("db.query.users", async (span) => {
    try {
      // Add attributes for debugging. These show up as tags in Jaeger.
      // Use semantic conventions where possible (db.system, db.statement).
      span.setAttribute("db.system", "postgresql");
      span.setAttribute("db.statement", "SELECT * FROM users LIMIT 100");
      span.setAttribute("db.operation.name", "SELECT");

      // Simulated database query
      await new Promise((r) => setTimeout(r, 50 + Math.random() * 100));
      const users = [
        { id: 1, name: "Alice", email: "alice@example.com" },
        { id: 2, name: "Bob", email: "bob@example.com" },
      ];

      // Record the result count as an attribute.
      // Useful for spotting queries that return unexpectedly many rows.
      span.setAttribute("db.result.count", users.length);

      res.json({ users });
    } catch (err) {
      // Record errors on the span so they show up as red in Jaeger.
      // recordException adds the error message and stack trace.
      // setStatus marks the span as failed.
      span.recordException(err as Error);
      span.setStatus({ code: SpanStatusCode.ERROR, message: "DB query failed" });
      res.status(500).json({ error: "Failed to fetch users" });
    } finally {
      // Always end the span, even on error. Unended spans are leaked
      // and won't be exported.
      span.end();
    }
  });
});

// ---------------------------------------------------------------------------
// GET /users/:id — Custom attributes for request-specific data
// ---------------------------------------------------------------------------
// Demonstrates adding request parameters as span attributes so you can
// search for a specific user's traces in Jaeger.

app.get("/users/:id", async (req: Request, res: Response) => {
  const userId = req.params.id;

  await tracer.startActiveSpan("db.query.user_by_id", async (span) => {
    try {
      // Add the user ID so you can search: user.id = "42" in Jaeger.
      // Never add PII (emails, passwords) as span attributes — they're
      // stored in your tracing backend and may not be encrypted.
      span.setAttribute("user.id", userId);
      span.setAttribute("db.system", "postgresql");
      span.setAttribute("db.statement", "SELECT * FROM users WHERE id = $1");

      // Simulated query
      await new Promise((r) => setTimeout(r, 20 + Math.random() * 50));

      // Simulate user not found for odd IDs
      if (parseInt(userId) % 2 === 0) {
        span.setAttribute("user.found", true);
        res.json({ id: userId, name: "Alice", email: "alice@example.com" });
      } else {
        span.setAttribute("user.found", false);
        res.status(404).json({ error: "User not found" });
      }
    } catch (err) {
      span.recordException(err as Error);
      span.setStatus({ code: SpanStatusCode.ERROR });
      res.status(500).json({ error: "Internal server error" });
    } finally {
      span.end();
    }
  });
});

// ---------------------------------------------------------------------------
// POST /orders — Nested spans for multi-step business logic
// ---------------------------------------------------------------------------
// Complex operations benefit from nested spans. Each step (validate, charge,
// save) gets its own span, making it easy to see which step is slow or failing
// in the trace waterfall.

app.post("/orders", async (req: Request, res: Response) => {
  await tracer.startActiveSpan("order.create", async (parentSpan) => {
    try {
      const orderData = req.body;
      parentSpan.setAttribute("order.item_count", orderData.items?.length || 0);

      // Step 1: Validate the order
      await tracer.startActiveSpan("order.validate", async (validateSpan) => {
        validateSpan.setAttribute("validation.type", "schema");
        await new Promise((r) => setTimeout(r, 10));
        validateSpan.end();
      });

      // Step 2: Process payment
      // SpanKind.CLIENT indicates this is an outgoing call to another service.
      // Jaeger uses the kind to draw arrows between services in the trace view.
      await tracer.startActiveSpan(
        "payment.charge",
        { kind: SpanKind.CLIENT },
        async (paymentSpan) => {
          paymentSpan.setAttribute("payment.provider", "stripe");
          paymentSpan.setAttribute("payment.amount_cents", 4999);
          paymentSpan.setAttribute("payment.currency", "USD");

          // Simulated payment API call
          await new Promise((r) => setTimeout(r, 100 + Math.random() * 200));
          paymentSpan.setAttribute("payment.transaction_id", "txn_abc123");
          paymentSpan.end();
        }
      );

      // Step 3: Save order to database
      await tracer.startActiveSpan("db.insert.order", async (dbSpan) => {
        dbSpan.setAttribute("db.system", "postgresql");
        dbSpan.setAttribute("db.operation.name", "INSERT");

        await new Promise((r) => setTimeout(r, 30 + Math.random() * 50));
        dbSpan.end();
      });

      // Add a span event — a timestamped log message attached to the span.
      // Events are lighter than child spans and good for noting milestones.
      parentSpan.addEvent("order.completed", {
        "order.id": "ord_xyz789",
      });

      res.status(201).json({ orderId: "ord_xyz789", status: "created" });
    } catch (err) {
      parentSpan.recordException(err as Error);
      parentSpan.setStatus({ code: SpanStatusCode.ERROR });
      res.status(500).json({ error: "Failed to create order" });
    } finally {
      parentSpan.end();
    }
  });
});

// ---------------------------------------------------------------------------
// GET /external — Trace context propagation
// ---------------------------------------------------------------------------
// When Service A calls Service B, trace context propagation links their
// spans into a single distributed trace. OpenTelemetry auto-instrumentation
// handles this for HTTP calls — it injects the traceparent header
// automatically into outgoing fetch/http requests.
//
// The receiving service (if also instrumented) reads the header and creates
// child spans under the same trace ID.

app.get("/external", async (_req: Request, res: Response) => {
  await tracer.startActiveSpan(
    "external.api.call",
    { kind: SpanKind.CLIENT },
    async (span) => {
      try {
        span.setAttribute("http.url", "https://jsonplaceholder.typicode.com/posts/1");
        span.setAttribute("http.method", "GET");

        // fetch() is auto-instrumented — OpenTelemetry injects the
        // traceparent header automatically. The receiving service sees:
        //   traceparent: 00-<trace_id>-<span_id>-01
        // and creates child spans under the same trace.
        const response = await fetch(
          "https://jsonplaceholder.typicode.com/posts/1"
        );
        const data = await response.json();

        span.setAttribute("http.status_code", response.status);
        res.json({ source: "external", data });
      } catch (err) {
        span.recordException(err as Error);
        span.setStatus({ code: SpanStatusCode.ERROR });
        res.status(502).json({ error: "External API call failed" });
      } finally {
        span.end();
      }
    }
  );
});

// ---------------------------------------------------------------------------
// GET /health — Health check (excluded from tracing by default)
// ---------------------------------------------------------------------------
// Health checks fire every few seconds from load balancers and orchestrators.
// They'd flood Jaeger with noise if traced. Auto-instrumentation captures
// them, but you can filter them out in Jaeger's UI or configure the
// instrumentation to ignore specific paths.

app.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "healthy", uptime: process.uptime() });
});

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`  GET  http://localhost:${PORT}/          — Home`);
  console.log(`  GET  http://localhost:${PORT}/users     — List users`);
  console.log(`  GET  http://localhost:${PORT}/users/2   — Get user`);
  console.log(`  POST http://localhost:${PORT}/orders    — Create order`);
  console.log(`  GET  http://localhost:${PORT}/external  — External call`);
  console.log(`  GET  http://localhost:${PORT}/health    — Health check`);
  console.log("");
  console.log("View traces: http://localhost:16686 (Jaeger UI)");
});
