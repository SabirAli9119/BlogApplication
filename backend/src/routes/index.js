import { Router } from "express";
import mongoose from "mongoose";
import authRoutes from "./auth.routes.js";
import userRoutes from "./user.routes.js";
import blogRoutes from "./blog.routes.js";
import blogDetailRoutes from "./blogDetail.routes.js";
import commentRoutes from "./comment.routes.js";
import bookmarkRoutes from "./bookmark.routes.js";
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
router.use("/users", userRoutes);
router.use("/blogs", blogRoutes); // fixed paths first: /mine, /trending, ...
router.use("/blogs", blogDetailRoutes); // then /:slug, /:id/comments, /:id/like, ...
router.use("/comments", commentRoutes);
router.use("/bookmarks", bookmarkRoutes);
router.use("/categories", categoryRoutes);
router.get("/home", optionalAuth, home);

export default router;