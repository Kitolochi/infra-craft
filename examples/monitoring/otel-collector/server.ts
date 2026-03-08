import { NodeSDK } from "@opentelemetry/sdk-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { Resource } from "@opentelemetry/resources";
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from "@opentelemetry/semantic-conventions";
import { HttpInstrumentation } from "@opentelemetry/instrumentation-http";
import { trace, metrics, SpanStatusCode } from "@opentelemetry/api";

// ---- Initialize OpenTelemetry SDK ----

const sdk = new NodeSDK({
  resource: new Resource({
    [ATTR_SERVICE_NAME]: "otel-demo-server",
    [ATTR_SERVICE_VERSION]: "1.0.0",
  }),
  traceExporter: new OTLPTraceExporter({
    url: "http://localhost:4318/v1/traces",
  }),
  metricReader: new PeriodicExportingMetricReader({
    exporter: new OTLPMetricExporter({
      url: "http://localhost:4318/v1/metrics",
    }),
    exportIntervalMillis: 10_000,
  }),
  instrumentations: [new HttpInstrumentation()],
});

sdk.start();
console.log("OpenTelemetry SDK initialized");

// ---- Custom metrics ----

const meter = metrics.getMeter("otel-demo");
const requestCounter = meter.createCounter("http_requests_total", {
  description: "Total HTTP requests",
});
const requestDuration = meter.createHistogram("http_request_duration_ms", {
  description: "HTTP request duration in milliseconds",
});

// ---- Express app with manual spans ----

import express from "express";

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const tracer = trace.getTracer("otel-demo");

app.get("/", (_req, res) => {
  const start = Date.now();

  tracer.startActiveSpan("handle-root", (span) => {
    span.setAttribute("http.route", "/");
    requestCounter.add(1, { route: "/", method: "GET" });

    res.json({
      message: "OTel Collector demo",
      traceId: span.spanContext().traceId,
      links: {
        jaeger: "http://localhost:16686",
        prometheus: "http://localhost:9090",
        grafana: "http://localhost:3001",
      },
    });

    requestDuration.record(Date.now() - start, { route: "/" });
    span.end();
  });
});

app.get("/slow", async (_req, res) => {
  const start = Date.now();

  await tracer.startActiveSpan("handle-slow", async (span) => {
    span.setAttribute("http.route", "/slow");
    requestCounter.add(1, { route: "/slow", method: "GET" });

    // Simulate nested spans (e.g., DB call + external API)
    await tracer.startActiveSpan("db-query", async (dbSpan) => {
      await new Promise((r) => setTimeout(r, 50 + Math.random() * 100));
      dbSpan.setAttribute("db.system", "postgresql");
      dbSpan.setAttribute("db.statement", "SELECT * FROM users");
      dbSpan.end();
    });

    await tracer.startActiveSpan("external-api-call", async (apiSpan) => {
      await new Promise((r) => setTimeout(r, 100 + Math.random() * 200));
      apiSpan.setAttribute("http.url", "https://api.example.com/data");
      apiSpan.end();
    });

    res.json({ message: "Slow endpoint", duration: Date.now() - start });
    requestDuration.record(Date.now() - start, { route: "/slow" });
    span.end();
  });
});

app.get("/error", (_req, res) => {
  tracer.startActiveSpan("handle-error", (span) => {
    requestCounter.add(1, { route: "/error", method: "GET" });
    span.setStatus({ code: SpanStatusCode.ERROR, message: "Simulated error" });
    span.recordException(new Error("Something went wrong"));
    res.status(500).json({ error: "Simulated error for tracing demo" });
    span.end();
  });
});

app.listen(PORT, () => {
  console.log(`Demo server on http://localhost:${PORT}`);
  console.log("Run 'npm run infra' first to start OTel Collector + Jaeger + Prometheus + Grafana");
});

// Graceful shutdown
process.on("SIGTERM", () => sdk.shutdown());
process.on("SIGINT", () => sdk.shutdown());
