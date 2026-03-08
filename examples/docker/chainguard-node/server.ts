import { createServer } from "node:http";

const PORT = Number(process.env.PORT) || 3000;

const server = createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({
    message: "Hello from container",
    runtime: process.version,
    platform: process.platform,
    uptime: process.uptime(),
  }));
});

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
