import http from "http";
import app from "./app.js";
import { env } from "./config/env.js";
import { connectDB, disconnectDB } from "./config/db.js";

let server;

const start = async () => {
  await connectDB();
  server = http.createServer(app); // Socket.IO attaches here in Phase 16
  server.listen(env.port, () => {
    console.log(`Server running on http://localhost:${env.port} [${env.nodeEnv}]`);
  });
};

const shutdown = async (signal) => {
  console.log(`\n${signal} received, shutting down...`);
  server?.close(async () => {
    await disconnectDB();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref(); // force exit if stuck
};

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("unhandledRejection", (err) => {
  console.error("Unhandled rejection:", err);
  shutdown("unhandledRejection");
});

start().catch((err) => {
  console.error("Failed to start server:", err.message);
  process.exit(1);
});