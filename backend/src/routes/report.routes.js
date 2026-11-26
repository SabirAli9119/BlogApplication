import { Router } from "express";
import * as c from "../controllers/report.controller.js";
import { validate } from "../middleware/validate.middleware.js";
import { authenticate } from "../middleware/auth.middleware.js";
import { optionalAuth } from "../middleware/optionalAuth.middleware.js";
import { reportLimiter, passwordResetLimiter } from "../middleware/rateLimiter.middleware.js";
import { createReportSchema, myReportsSchema, appealSchema } from "../validators/report.validator.js";

const router = Router();

router.post("/", authenticate, reportLimiter, validate(createReportSchema), c.create);
router.get("/mine", authenticate, validate(myReportsSchema), c.mine);
router.post("/:id/appeal", passwordResetLimiter, optionalAuth, validate(appealSchema), c.appeal);

export default router;