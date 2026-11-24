import { Router } from "express";
import * as c from "../controllers/blog.controller.js";

const router = Router();

router.get("/", c.categories);
router.get("/popular", c.popularCategories);

export default router;