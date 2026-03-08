// =============================================================================
// OpenTelemetry Tracing Setup — Auto-Instrumentation + OTLP Export
// =============================================================================
// IMPORTANT: This file must be loaded BEFORE any other imports.
// OpenTelemetry patches libraries (express, http, pg) at import time.
// If Express is imported before this file runs, it won't be instrumented.
//
// Usage:
//   node --import ./tracing.ts server.ts          (Node 20+)
//   node --require ./tracing.ts server.ts         (Node 18)
//   npx tsx tracing.ts                            (loads then chains to server)
//
// Environment variables:
//   OTEL_SERVICE_NAME        — Name shown in Jaeger/Grafana (default: "my-api")
//   OTEL_EXPORTER_OTLP_ENDPOINT — Collector URL (default: "http://localhost:4318")
//   OTEL_ENVIRONMENT         — Deployment environment tag (default: "development")
// =============================================================================

import { NodeSDK } from "@opentelemetry/sdk-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { Resource } from "@opentelemetry/resources";
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
  ATTR_DEPLOYMENT_ENVIRONMENT_NAME,
} from "@opentelemetry/semantic-conventions";
import { diag, DiagConsoleLogger, DiagLogLevel } from "@opentelemetry/api";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const SERVICE_NAME = process.env.OTEL_SERVICE_NAME || "my-api";
const OTLP_ENDPOINT =
  process.env.OTEL_EXPORTER_OTLP_ENDPOINT || "http://localhost:4318";
const ENVIRONMENT = process.env.OTEL_ENVIRONMENT || "development";
const APP_VERSION = process.env.APP_VERSION || "1.0.0";

// ---------------------------------------------------------------------------
// Diagnostic logging (optional)
// ---------------------------------------------------------------------------
// Enable OpenTelemetry's internal debug logging.
// Useful when traces aren't showing up in Jaeger — set to DiagLogLevel.DEBUG
// to see what the SDK is doing internally.
// In production, disable this or set to DiagLogLevel.ERROR.

if (process.env.OTEL_LOG_LEVEL === "debug") {
  diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.DEBUG);
}

// ---------------------------------------------------------------------------
// Resource — metadata attached to every span and metric
// ---------------------------------------------------------------------------
// Resources describe the entity producing telemetry. Every span emitted by
// this service will carry these attributes, making it easy to filter in
// Jaeger/Grafana by service name, version, or environment.

const resource = new Resource({
  [ATTR_SERVICE_NAME]: SERVICE_NAME,
  [ATTR_SERVICE_VERSION]: APP_VERSION,
  [ATTR_DEPLOYMENT_ENVIRONMENT_NAME]: ENVIRONMENT,
});

// ---------------------------------------------------------------------------
// Trace exporter — sends spans to Jaeger/Grafana Tempo via OTLP
// ---------------------------------------------------------------------------
// OTLP (OpenTelemetry Protocol) is the standard export format.
// Both Jaeger and Grafana Tempo accept OTLP directly — no need for
// vendor-specific exporters.
//
// The /v1/traces path is appended automatically by the exporter.
// So if Jaeger is at localhost:4318, traces go to localhost:4318/v1/traces.

const traceExporter = new OTLPTraceExporter({
  url: `${OTLP_ENDPOINT}/v1/traces`,
});

// ---------------------------------------------------------------------------
// Metric exporter — sends metrics to an OTLP-compatible backend
// ---------------------------------------------------------------------------
// PeriodicExportingMetricReader collects metrics on an interval and sends
// them in batch. 30 seconds is a good default — frequent enough for
// dashboards, not so frequent that it overwhelms the backend.

const metricReader = new PeriodicExportingMetricReader({
  exporter: new OTLPMetricExporter({
    url: `${OTLP_ENDPOINT}/v1/metrics`,
  }),
  exportIntervalMillis: 30_000,
});

// ---------------------------------------------------------------------------
// Auto-instrumentation — patches popular libraries automatically
// ---------------------------------------------------------------------------
// Instead of manually adding trace code to every Express route, database
// query, and HTTP call, auto-instrumentation patches these libraries at
// import time to emit spans automatically.
//
// What gets instrumented:
//   @opentelemetry/instrumentation-http     — All outgoing/incoming HTTP
//   @opentelemetry/instrumentation-express  — Express routes and middleware
//   @opentelemetry/instrumentation-pg       — PostgreSQL queries
//   @opentelemetry/instrumentation-redis    — Redis commands
//   @opentelemetry/instrumentation-dns      — DNS lookups
//
// We disable fs instrumentation because it creates noisy spans for every
// file read (config files, node_modules, etc.) that clutter traces.

const instrumentations = [
  getNodeAutoInstrumentations({
    "@opentelemetry/instrumentation-fs": { enabled: false },
  }),
];

// ---------------------------------------------------------------------------
// SDK initialization
// ---------------------------------------------------------------------------
// The NodeSDK ties everything together: resource metadata, exporters, and
// instrumentations. Once started, it hooks into the Node.js runtime to
// capture traces and metrics automatically.

const sdk = new NodeSDK({
  resource,
  traceExporter,
  metricReader,
  instrumentations,
});

sdk.start();
console.log(
  `[OpenTelemetry] Tracing initialized for "${SERVICE_NAME}" → ${OTLP_ENDPOINT}`
);

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------
// On process exit, flush any buffered spans so they aren't lost.
// Without this, the last few seconds of traces before a restart/deploy
// would be silently dropped.

process.on("SIGTERM", async () => {
  console.log("[OpenTelemetry] Shutting down...");
  await sdk.shutdown();
  console.log("[OpenTelemetry] Shutdown complete.");
});
