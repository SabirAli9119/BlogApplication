import { Router } from "express";
import * as c from "../controllers/admin.controller.js";
import * as content from "../controllers/adminContent.controller.js";
import * as moderation from "../controllers/adminModeration.controller.js";
import { validate } from "../middleware/validate.middleware.js";
import { authenticate } from "../middleware/auth.middleware.js";
import { requireAdmin, requirePermission, requireAnyPermission } from "../middleware/authorize.middleware.js";
import { PERMISSIONS as P } from "../constants/permissions.js";
import {
  analyticsQuerySchema, listUsersSchema, suggestionsSchema, userIdParamSchema, statusSchema,
  roleSchema, verifySchema, restrictionsSchema, reasonOnlySchema,
} from "../validators/admin.validator.js";
import {
  adminBlogsQuerySchema, adminBlogIdSchema, adminEditBlogSchema, adminBlogStatusSchema, adminFeatureSchema,
  adminReasonSchema, createCategorySchema, updateCategorySchema, deleteCategorySchema,
  updateRolePermissionsSchema, adminReportsQuerySchema, reviewReportSchema, reviewAppealSchema,
} from "../validators/adminContent.validator.js";

const router = Router();

// everything below needs a logged-in admin, and admin data is never cached
router.use(authenticate, requireAdmin);
router.use((req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});

/* what can I do? (any admin, used by the UI to hide buttons) */
router.get("/me/permissions", moderation.myPermissions);

/* dashboard and analytics */
router.get("/dashboard", requirePermission(P.ANALYTICS_VIEW), c.dashboard);
router.get("/analytics", requirePermission(P.ANALYTICS_VIEW), validate(analyticsQuerySchema), c.platformAnalytics);

/* users */
router.get("/users", requirePermission(P.USERS_VIEW), validate(listUsersSchema), c.listUsers);
router.get("/users/suggestions", requirePermission(P.USERS_VIEW), validate(suggestionsSchema), c.suggestions);
router.get("/users/:id", requirePermission(P.USERS_VIEW), validate(userIdParamSchema), c.getUser);
router.patch("/users/:id/status", requireAnyPermission(P.USERS_SUSPEND, P.USERS_BAN), validate(statusSchema), c.changeStatus);
router.patch("/users/:id/role", requirePermission(P.USERS_MANAGE_ROLES), validate(roleSchema), c.changeRole);
router.patch("/users/:id/verify", requirePermission(P.USERS_VERIFY), validate(verifySchema), c.verify);
router.put("/users/:id/restrictions", requirePermission(P.USERS_RESTRICT), validate(restrictionsSchema), c.restrictions);
router.post("/users/:id/revoke-sessions", requirePermission(P.USERS_REVOKE_SESSIONS), validate(reasonOnlySchema), c.revokeSessions);
router.post("/users/:id/restore", requirePermission(P.USERS_RESTORE), validate(reasonOnlySchema), c.restore);

/* roles and permissions */
router.get("/permissions", requirePermission(P.ROLES_MANAGE), moderation.permissions);
router.get("/roles", requirePermission(P.ROLES_MANAGE), moderation.listRoles);
router.put("/roles/:id/permissions", requirePermission(P.ROLES_MANAGE), validate(updateRolePermissionsSchema), moderation.updateRolePermissions);

/* blogs (the services re-check the finer permissions, e.g. drafts and removal) */
router.get("/blogs", requirePermission(P.BLOGS_VIEW_ALL), validate(adminBlogsQuerySchema), content.listBlogs);
router.get("/blogs/:id", requirePermission(P.BLOGS_VIEW_ALL), validate(adminBlogIdSchema), content.getBlog);
router.put("/blogs/:id", requirePermission(P.BLOGS_EDIT_ANY), validate(adminEditBlogSchema), content.editBlog);
router.patch("/blogs/:id/status", requirePermission(P.BLOGS_EDIT_ANY), validate(adminBlogStatusSchema), content.changeBlogStatus);
router.patch("/blogs/:id/feature", requirePermission(P.BLOGS_FEATURE), validate(adminFeatureSchema), content.featureBlog);
router.delete("/blogs/:id", requirePermission(P.BLOGS_DELETE_ANY), validate(adminReasonSchema), content.deleteBlog);
router.post("/blogs/:id/restore", requirePermission(P.BLOGS_DELETE_ANY), validate(adminReasonSchema), content.restoreBlog);

/* categories */
router.get("/categories", requirePermission(P.CATEGORIES_MANAGE), content.listCategories);
router.post("/categories", requirePermission(P.CATEGORIES_MANAGE), validate(createCategorySchema), content.createCategory);
router.put("/categories/:id", requirePermission(P.CATEGORIES_MANAGE), validate(updateCategorySchema), content.updateCategory);
router.delete("/categories/:id", requirePermission(P.CATEGORIES_MANAGE), validate(deleteCategorySchema), content.deleteCategory);

/* reports and appeals */
router.get("/reports", requirePermission(P.REPORTS_VIEW), validate(adminReportsQuerySchema), moderation.listReports);
router.patch("/reports/:id", requirePermission(P.REPORTS_RESOLVE), validate(reviewReportSchema), moderation.reviewReport);
router.patch("/reports/:id/appeal", requirePermission(P.REPORTS_RESOLVE), validate(reviewAppealSchema), moderation.reviewAppeal);

export default router;