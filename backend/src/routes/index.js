import { Router } from "express";
import mongoose from "mongoose";
import authRoutes from "./auth.routes.js";
import blogRoutes from "./blog.routes.js";
import categoryRoutes from "./category.routes.js";
import { optionalAuth } from "../middleware/optionalAuth.middleware.js";
import { home } from "../controllers/blog.controller.js";

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

router.use("/auth", authRoutes);
router.use("/blogs", blogRoutes);
router.use("/categories", categoryRoutes);
router.get("/home", optionalAuth, home);

export default router;