// =============================================================================
// Graceful Shutdown Server — Production Shutdown Pattern
// =============================================================================
// Run: npx tsx server.ts
//
// Demonstrates the correct way to shut down a Node.js HTTP server in
// production. Without graceful shutdown, active requests are abruptly killed
// during deployments, causing 502 errors for users.
//
// Shutdown sequence:
//   1. Stop accepting new connections
//   2. Return 503 for new requests that arrive on existing connections
//   3. Wait for in-flight requests to complete (with timeout)
//   4. Close database pool
//   5. Close Redis connection
//   6. Flush logs
//   7. Exit with code 0
// =============================================================================

import express, { Request, Response, NextFunction } from "express";
import { createServer, Server } from "http";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const PORT = parseInt(process.env.PORT || "3000", 10);

// Maximum time to wait for in-flight requests to complete before force-killing.
// Set this shorter than your orchestrator's termination grace period.
// Kubernetes default is 30s, so 25s gives a 5s buffer.
const SHUTDOWN_TIMEOUT_MS = parseInt(
  process.env.SHUTDOWN_TIMEOUT_MS || "25000",
  10
);

// ---------------------------------------------------------------------------
// State tracking
// ---------------------------------------------------------------------------

// Tracks how many requests are currently being processed.
// Shutdown waits for this to reach zero.
let inFlightRequests = 0;

// Flipped to true when a shutdown signal is received.
// Prevents new requests from being accepted during drain.
let isShuttingDown = false;

// ---------------------------------------------------------------------------
// Simulated dependencies
// ---------------------------------------------------------------------------
// Replace these with actual connection closers in a real app.

async function closeDatabasePool(): Promise<void> {
  // Real: await pool.end();
  console.log("  Closing database pool...");
  await new Promise((r) => setTimeout(r, 500));
  console.log("  Database pool closed.");
}

async function closeRedisConnection(): Promise<void> {
  // Real: await redis.quit();
  console.log("  Closing Redis connection...");
  await new Promise((r) => setTimeout(r, 200));
  console.log("  Redis connection closed.");
}

async function flushLogs(): Promise<void> {
  // Real: await logger.flush(); or await transport.close();
  console.log("  Flushing log buffers...");
  await new Promise((r) => setTimeout(r, 100));
  console.log("  Logs flushed.");
}

// ---------------------------------------------------------------------------
// Express app
// ---------------------------------------------------------------------------

const app = express();

// --- Middleware: Reject requests during shutdown ---
// Once shutdown starts, new requests get 503 Service Unavailable.
// This is important because the server socket stays open briefly while
// draining. Without this middleware, new requests would start processing
// just as we're trying to shut down.
app.use((req: Request, res: Response, next: NextFunction) => {
  if (isShuttingDown) {
    // The Retry-After header tells load balancers and clients to retry
    // on a different instance.
    res.setHeader("Connection", "close");
    res.setHeader("Retry-After", "5");
    res.status(503).json({
      error: "Service is shutting down",
      retryAfter: 5,
    });
    return;
  }
  next();
});

// --- Middleware: Track in-flight requests ---
// Increments a counter when a request starts, decrements when it finishes.
// The shutdown procedure waits for this counter to reach zero.
app.use((req: Request, res: Response, next: NextFunction) => {
  inFlightRequests++;

  // 'close' fires when the underlying connection is closed, which happens
  // after the response is fully sent OR if the client disconnects early.
  // Using 'close' instead of 'finish' ensures we decrement even on aborted
  // requests, so the counter never gets stuck.
  res.on("close", () => {
    inFlightRequests--;
  });

  next();
});

// --- Routes ---
app.get("/health", (_req: Request, res: Response) => {
  res.json({
    status: isShuttingDown ? "shutting_down" : "healthy",
    uptime: process.uptime(),
    inFlightRequests,
  });
});

// Simulates a slow request to test graceful shutdown.
// Start the server, hit this endpoint, then send SIGTERM while it's processing.
app.get("/slow", async (_req: Request, res: Response) => {
  console.log(`Processing slow request (in-flight: ${inFlightRequests})`);
  await new Promise((r) => setTimeout(r, 5000));
  res.json({ message: "Slow request completed", took: "5s" });
});

app.get("/", (_req: Request, res: Response) => {
  res.json({ message: "API is running", inFlightRequests });
});

// ---------------------------------------------------------------------------
// Create HTTP server
// ---------------------------------------------------------------------------
// We create the server explicitly (instead of app.listen) so we have a
// reference to call server.close() during shutdown.

const server: Server = createServer(app);

// ---------------------------------------------------------------------------
// Graceful shutdown handler
// ---------------------------------------------------------------------------

async function gracefulShutdown(signal: string): Promise<void> {
  // Guard against multiple signals triggering concurrent shutdowns.
  // Docker sends SIGTERM, then SIGKILL after grace period. Some environments
  // may also send SIGINT. We only want to run shutdown once.
  if (isShuttingDown) {
    console.log(`Already shutting down, ignoring ${signal}`);
    return;
  }

  console.log(`\n[${signal}] Graceful shutdown initiated...`);
  isShuttingDown = true;

  // Step 1: Stop accepting new connections.
  // server.close() stops the server from accepting new connections but lets
  // existing connections finish. Its callback fires when all connections close.
  console.log("Step 1: Stopping new connections...");
  server.close(() => {
    console.log("  All connections closed.");
  });

  // Step 2: Wait for in-flight requests to complete.
  // Poll the counter with a hard timeout to avoid waiting forever.
  console.log(
    `Step 2: Waiting for ${inFlightRequests} in-flight request(s)...`
  );

  const drainStart = Date.now();
  await new Promise<void>((resolve) => {
    const checkInterval = setInterval(() => {
      const elapsed = Date.now() - drainStart;

      if (inFlightRequests <= 0) {
        clearInterval(checkInterval);
        console.log("  All in-flight requests completed.");
        resolve();
      } else if (elapsed >= SHUTDOWN_TIMEOUT_MS) {
        clearInterval(checkInterval);
        console.warn(
          `  Timeout: ${inFlightRequests} request(s) still in flight after ${SHUTDOWN_TIMEOUT_MS}ms. Force closing.`
        );
        resolve();
      } else {
        console.log(
          `  Waiting... ${inFlightRequests} request(s) in flight (${Math.round(elapsed / 1000)}s elapsed)`
        );
      }
    }, 1000);
  });

  // Step 3-5: Close external connections.
  // Order matters: close the database last since other cleanup steps might
  // need it (e.g., flushing a job queue that writes to the DB).
  console.log("Step 3: Closing external connections...");

  try {
    await closeRedisConnection();
    await closeDatabasePool();
    await flushLogs();
  } catch (err) {
    // Log but don't throw — we still want to exit cleanly.
    console.error("Error during cleanup:", err);
  }

  // Step 6: Exit.
  // Exit code 0 tells the orchestrator this was intentional.
  // The orchestrator then starts a new instance if needed.
  console.log("Shutdown complete. Exiting.");
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Signal handlers
// ---------------------------------------------------------------------------
// SIGTERM: Sent by orchestrators (Kubernetes, Docker, systemd) to request
//          a graceful stop. This is the primary shutdown signal.
// SIGINT:  Sent when you press Ctrl+C in the terminal. Handle it the same
//          way so local development behaves like production.
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

// ---------------------------------------------------------------------------
// Crash handlers
// ---------------------------------------------------------------------------

// uncaughtException: A synchronous error that wasn't caught by any try/catch.
// The process is in an undefined state — the only safe action is to log and exit.
// Do NOT try to continue serving requests after an uncaught exception.
process.on("uncaughtException", (err: Error) => {
  console.error("UNCAUGHT EXCEPTION — shutting down immediately");
  console.error(err.stack || err.message);

  // Exit with code 1 (failure) so the orchestrator knows to restart.
  // Don't attempt graceful shutdown here — the process state is unreliable.
  process.exit(1);
});

// unhandledRejection: A Promise rejected with no .catch() handler.
// Starting in Node 15+, these crash the process by default.
// We log the error and exit with a failure code.
process.on("unhandledRejection", (reason: unknown) => {
  console.error("UNHANDLED REJECTION — shutting down immediately");
  console.error(reason);

  // Throw so it becomes an uncaughtException, triggering the handler above.
  // This ensures consistent crash behavior.
  throw reason;
});

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT} (PID: ${process.pid})`);
  console.log(`  GET http://localhost:${PORT}/        — Home`);
  console.log(`  GET http://localhost:${PORT}/health  — Health check`);
  console.log(`  GET http://localhost:${PORT}/slow    — Slow request (5s)`);
  console.log("");
  console.log("Test graceful shutdown:");
  console.log("  1. In another terminal: curl http://localhost:3000/slow");
  console.log("  2. While it's processing: kill -SIGTERM " + process.pid);
  console.log("  3. Watch the shutdown sequence in this terminal");
});
