# PM2 Ecosystem Configuration

Production-ready PM2 configuration with cluster mode, file watching, and multi-environment support.

## What's Included

The `ecosystem.config.cjs` defines three app profiles:

| Profile | Mode | Instances | Use case |
|---------|------|-----------|----------|
| `api-prod` | Cluster | max (all CPUs) | Production deployment |
| `api-dev` | Fork | 1 | Local development with file watching |
| `api-staging` | Cluster | 2 | Staging environment |

## Install PM2

```bash
# Global install (recommended for production servers)
npm install -g pm2

# Or as a project dependency
npm install --save-dev pm2
```

## Commands Reference

### Starting Apps

```bash
# Start all apps defined in the ecosystem file
pm2 start ecosystem.config.cjs

# Start a specific app by name
pm2 start ecosystem.config.cjs --only api-prod

# Start with a specific environment
pm2 start ecosystem.config.cjs --only api-staging --env staging

# Start development (with file watching)
pm2 start ecosystem.config.cjs --only api-dev
```

### Stopping and Restarting

```bash
# Stop a specific app
pm2 stop api-prod

# Stop all apps
pm2 stop all

# Restart a specific app (kills and starts)
pm2 restart api-prod

# Graceful reload (zero-downtime, cluster mode only)
# Restarts instances one-by-one so there's always at least one running
pm2 reload api-prod

# Delete an app from PM2's process list
pm2 delete api-prod

# Delete all
pm2 delete all
```

### Monitoring

```bash
# List all running processes with status, CPU, memory
pm2 list

# Real-time dashboard: CPU, memory, logs, restart count
pm2 monit

# Detailed info about a specific app
pm2 describe api-prod

# Show real-time logs
pm2 logs

# Show logs for a specific app
pm2 logs api-prod

# Show last 100 lines
pm2 logs api-prod --lines 100

# Clear all log files
pm2 flush
```

### Persistence (Survive Reboots)

```bash
# Save the current process list
# PM2 will restore these exact processes on restart
pm2 save

# Generate a startup script for your OS
# This creates a systemd/init.d service that starts PM2 on boot
pm2 startup

# Remove the startup script
pm2 unstartup
```

### Scaling

```bash
# Scale to a specific number of instances
pm2 scale api-prod 4

# Add 2 more instances
pm2 scale api-prod +2

# Scale to match CPU count
pm2 scale api-prod max
```

### Log Rotation

```bash
# Install the log rotation module
pm2 install pm2-logrotate

# Configure max size per file (default: 10MB)
pm2 set pm2-logrotate:max_size 50M

# Configure number of rotated files to keep
pm2 set pm2-logrotate:retain 30

# Configure rotation interval (cron format)
pm2 set pm2-logrotate:rotateInterval '0 0 * * *'

# Compress rotated files
pm2 set pm2-logrotate:compress true
```

## Zero-Downtime Deployments

```bash
# 1. Pull new code
git pull origin main

# 2. Install dependencies
npm ci --omit=dev

# 3. Build
npm run build

# 4. Graceful reload (zero-downtime)
pm2 reload api-prod

# 5. Verify
pm2 list
curl http://localhost:3000/health
```

## Cluster Mode Explained

When `exec_mode: "cluster"` and `instances: "max"`:

```
                    +-----------+
  Incoming    ----> | PM2       |
  Requests    ----> | (master)  |
                    +-----+-----+
                          |
          +---------------+---------------+
          |               |               |
    +-----v----+    +-----v----+    +-----v----+
    | Worker 1 |    | Worker 2 |    | Worker 3 |
    | (CPU 0)  |    | (CPU 1)  |    | (CPU 2)  |
    +----------+    +----------+    +----------+
```

- PM2 uses Node.js `cluster` module to fork processes
- Each worker runs on a separate CPU core
- PM2 load-balances requests across workers (round-robin)
- If a worker crashes, PM2 automatically spawns a replacement
- `pm2 reload` restarts workers one-by-one for zero downtime
