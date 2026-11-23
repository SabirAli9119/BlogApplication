import { Router } from "express";
import mongoose from "mongoose";

const router = Router();

router.get("/health", (req, res) => {
  const states = ["disconnected", "connected", "connecting", "disconnecting"];
  res.json({
    success: true,
    message: "Blogify API is running",
    uptime: Math.round(process.uptime()),
    database: states[mongoose.connection.readyState],
  });
});

// Later phases mount here, e.g. router.use("/auth", authRoutes);

export default router;