import { Router } from "express";
import * as c from "../controllers/dashboard.controller.js";
import { validate } from "../middleware/validate.middleware.js";
import { authenticate } from "../middleware/auth.middleware.js";
import { analyticsQuerySchema, articleAnalyticsSchema } from "../validators/dashboard.validator.js";

const router = Router();

router.use(authenticate); // everything here is private to the logged-in user

router.get("/overview", c.overview);
router.get("/analytics", validate(analyticsQuerySchema), c.analytics);
router.get("/articles/:id/analytics", validate(articleAnalyticsSchema), c.articleAnalytics);

export default router;