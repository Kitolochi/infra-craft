import express from "express";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const app = express();
const PORT = Number(process.env.PORT) || 3000;

// Serve static public/ directory (synced without restart)
app.use(express.static("public"));

// Config file (sync+restart — server re-reads on boot)
const configPath = join(import.meta.dirname, "config.json");
const config = existsSync(configPath)
  ? JSON.parse(readFileSync(configPath, "utf-8"))
  : { appName: "compose-watch-demo", version: "1.0.0" };

app.get("/", (_req, res) => {
  res.json({
    ...config,
    pid: process.pid,
    uptime: process.uptime(),
    message: "Edit files and watch Docker Compose sync changes!",
  });
});

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.listen(PORT, () => {
  console.log(`[compose-watch] ${config.appName} v${config.version} on :${PORT}`);
});
