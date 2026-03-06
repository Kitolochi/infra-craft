// =============================================================================
// PM2 Ecosystem Configuration
// =============================================================================
// PM2 is a production process manager for Node.js applications.
// This file defines how PM2 runs your app across different environments.
//
// Usage:
//   pm2 start ecosystem.config.cjs                    — Start all apps
//   pm2 start ecosystem.config.cjs --only api-prod    — Start specific app
//   pm2 start ecosystem.config.cjs --env staging      — Use staging env vars
//
// Why .cjs? PM2 uses require() to load this file. If your package.json has
// "type": "module", you need the .cjs extension to use CommonJS syntax.
// =============================================================================

module.exports = {
  apps: [
    // -------------------------------------------------------------------------
    // Production — Cluster mode for maximum throughput
    // -------------------------------------------------------------------------
    {
      name: "api-prod",

      // Entry point. PM2 runs this file with Node.js.
      // If using TypeScript, point to the compiled JS output.
      script: "dist/index.js",

      // --- Cluster mode ---
      // "cluster" mode uses Node.js cluster module to fork multiple processes.
      // Each process runs on a separate CPU core, sharing the same port.
      // This is the primary way to scale Node.js on a single machine.
      // "fork" mode (default) runs a single process — use for non-HTTP apps.
      exec_mode: "cluster",

      // Number of instances.
      // 0 or "max" = one per CPU core (recommended for production).
      // Set to a specific number to limit resource usage.
      instances: "max",

      // --- Environment variables ---
      // These are set when starting without --env flag.
      env: {
        NODE_ENV: "production",
        PORT: 3000,
      },

      // --- Restart behavior ---
      // Auto-restart on crash. Disable only for one-shot scripts.
      autorestart: true,

      // Wait 5 seconds between restarts.
      // Prevents rapid restart loops from overwhelming the system when the
      // app is crashing immediately on boot (e.g., missing env var).
      restart_delay: 5000,

      // Maximum number of restarts within a time window before PM2 gives up.
      // Prevents infinite restart loops.
      max_restarts: 10,

      // Minimum uptime to consider a start "successful".
      // If the app crashes before this threshold, it counts toward max_restarts.
      min_uptime: "10s",

      // Maximum memory per instance before PM2 auto-restarts it.
      // Catches memory leaks before they cause OOM kills.
      // Set based on your server's available RAM divided by instance count.
      max_memory_restart: "512M",

      // --- Graceful shutdown ---
      // Time to wait after SIGINT before force-killing (SIGKILL).
      // Must be longer than your app's graceful shutdown timeout.
      kill_timeout: 30000,

      // Send SIGINT instead of default SIGTERM for shutdown.
      // Some frameworks handle SIGINT more reliably.
      // Change to "SIGTERM" if your app listens for that.
      shutdown_with_message: false,

      // Wait for all connections to close before restarting.
      // Works with cluster mode to enable zero-downtime reloads.
      wait_ready: false,

      // Listen timeout: max time to wait for "ready" event from app.
      // Only relevant when wait_ready is true.
      listen_timeout: 10000,

      // --- Logging ---
      // Separate log files for stdout and stderr.
      // PM2 creates these files automatically.
      out_file: "./logs/api-prod-out.log",
      error_file: "./logs/api-prod-error.log",

      // Merge logs from all cluster instances into single files.
      // Without this, each instance gets its own log file (confusing).
      merge_logs: true,

      // Prefix each log line with the instance ID.
      // Useful for debugging issues specific to one cluster worker.
      instance_var: "INSTANCE_ID",

      // Timestamp format for log lines.
      // "YYYY-MM-DD HH:mm:ss" gives ISO-ish timestamps.
      log_date_format: "YYYY-MM-DD HH:mm:ss",

      // Maximum log file size before rotation.
      // Requires pm2-logrotate module: pm2 install pm2-logrotate
      // Configure rotation: pm2 set pm2-logrotate:max_size 50M
      // Configure retention: pm2 set pm2-logrotate:retain 30

      // --- Source maps ---
      // Enable Node.js source map support for better error stack traces.
      // Useful when running compiled TypeScript.
      source_map_support: true,
    },

    // -------------------------------------------------------------------------
    // Development — Fork mode with file watching
    // -------------------------------------------------------------------------
    {
      name: "api-dev",
      script: "src/index.ts",

      // Use tsx to run TypeScript directly without compilation.
      interpreter: "node_modules/.bin/tsx",

      // Fork mode: single process. Cluster mode is overkill for development
      // and can cause confusing behavior with debuggers.
      exec_mode: "fork",
      instances: 1,

      // --- File watching ---
      // Automatically restart when files change.
      // Only enable in development — in production, use deployments.
      watch: true,

      // Directories/files to watch for changes.
      watch: ["src"],

      // Patterns to ignore when watching.
      // Without these, node_modules changes (from npm install) or test runs
      // would trigger unnecessary restarts.
      ignore_watch: [
        "node_modules",
        "dist",
        "logs",
        "coverage",
        ".git",
        "*.test.ts",
        "*.spec.ts",
      ],

      // Delay between detecting a change and restarting (milliseconds).
      // Prevents rapid restarts when saving multiple files (e.g., IDE auto-save).
      watch_delay: 1000,

      env: {
        NODE_ENV: "development",
        PORT: 3000,
        LOG_LEVEL: "debug",
      },

      // Development logs to console (no files).
      out_file: "/dev/null",
      error_file: "/dev/null",

      autorestart: true,
      max_restarts: 50,
      restart_delay: 1000,
    },

    // -------------------------------------------------------------------------
    // Staging — Reduced instances, staging-specific config
    // -------------------------------------------------------------------------
    {
      name: "api-staging",
      script: "dist/index.js",

      exec_mode: "cluster",

      // Fewer instances than production.
      // Staging servers typically have fewer resources.
      instances: 2,

      env: {
        NODE_ENV: "staging",
        PORT: 3000,
        LOG_LEVEL: "debug",
      },

      // Staging env vars — activated with: pm2 start ecosystem.config.cjs --env staging
      // These override the base `env` values.
      env_staging: {
        NODE_ENV: "staging",
        PORT: 3000,
        LOG_LEVEL: "debug",
      },

      out_file: "./logs/api-staging-out.log",
      error_file: "./logs/api-staging-error.log",
      merge_logs: true,
      log_date_format: "YYYY-MM-DD HH:mm:ss",

      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000,
      max_memory_restart: "256M",
      kill_timeout: 30000,
      source_map_support: true,
    },
  ],
};
