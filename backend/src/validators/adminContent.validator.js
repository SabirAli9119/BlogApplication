import { z } from "zod";
import { postFields } from "./blog.validator.js";
import { ALL_PERMISSIONS } from "../constants/permissions.js";
import { REPORT_REASONS, REPORT_TARGETS } from "../constants/eventTypes.js";

const objectId = z.string().regex(/^[a-f\d]{24}$/i, "Invalid id");
const isoDate = z.string().refine((s) => !Number.isNaN(Date.parse(s)), "Invalid date");
const idParam = z.object({ id: objectId });
const paging = {
  page: z.coerce.number().int().min(1).max(10000).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
};
const reason = z
  .string()
  .trim()
  .min(3, "Give a reason (at least 3 characters)")
  .max(500, "The reason is too long (max 500 characters)");
const optionalReason = z.string().trim().max(500).optional();

/* ---------- blogs ---------- */

export const adminBlogsQuerySchema = z.object({
  query: z.object({
    q: z.string().trim().max(100).optional(),
    status: z.enum(["draft", "scheduled", "published", "unpublished", "removed"]).optional(),
    category: z.string().trim().toLowerCase().max(60).optional(),
    author: z.string().trim().toLowerCase().max(20).optional(),
    featured: z.enum(["true", "false"]).transform((v) => v === "true").optional(),
    deleted: z.enum(["exclude", "include", "only"]).optional(),
    sort: z.enum(["newest", "views", "updated"]).optional(),
    ...paging,
  }),
});

export const adminBlogIdSchema = z.object({ params: idParam });
export const adminEditBlogSchema = z.object({ params: idParam, body: z.object({ ...postFields, reason }) });
export const adminBlogStatusSchema = z.object({
  params: idParam,
  body: z.object({ status: z.enum(["published", "unpublished", "removed"]), reason }),
});
export const adminFeatureSchema = z.object({ params: idParam, body: z.object({ featured: z.boolean(), reason }) });
export const adminReasonSchema = z.object({ params: idParam, body: z.object({ reason }) }); // delete and restore

/* ---------- categories ---------- */

const categoryFields = {
  name: z.string().trim().min(2, "Use at least 2 characters").max(40),
  description: z.string().trim().max(200).optional(),
  sortOrder: z.number().int().min(0).max(1000).optional(),
};
export const createCategorySchema = z.object({ body: z.object({ ...categoryFields, reason: optionalReason }) });
export const updateCategorySchema = z.object({
  params: idParam,
  body: z.object({
    name: categoryFields.name.optional(),
    description: categoryFields.description,
    sortOrder: categoryFields.sortOrder,
    isActive: z.boolean().optional(),
    reason: optionalReason,
  }),
});
export const deleteCategorySchema = z.object({
  params: idParam,
  body: z.object({ reason: optionalReason }).default({}),
});

/* ---------- roles ---------- */

export const updateRolePermissionsSchema = z.object({
  params: idParam,
  body: z.object({ permissions: z.array(z.enum(ALL_PERMISSIONS)).max(50), reason }),
});

/* ---------- reports and appeals ---------- */

export const adminReportsQuerySchema = z.object({
  query: z.object({
    status: z.enum(["open", "reviewing", "resolved", "dismissed"]).optional(),
    targetType: z.enum(REPORT_TARGETS).optional(),
    reason: z.enum(REPORT_REASONS).optional(),
    appeal: z.enum(["pending", "upheld", "overturned", "any"]).optional(),
    sort: z.enum(["newest", "oldest"]).optional(),
    ...paging,
  }),
});

export const reviewReportSchema = z.object({
  params: idParam,
  body: z
    .object({
      status: z.enum(["reviewing", "resolved", "dismissed"]),
      action: z.enum(["none", "warn", "hide", "remove", "suspend", "ban"]).optional(),
      note: z.string().trim().max(500).optional(),
      until: isoDate.optional(), // only used for suspend and ban; leave out for a permanent one
    })
    .refine((d) => d.status !== "resolved" || Boolean(d.action), { message: "Choose an action", path: ["action"] })
    .refine((d) => d.status === "reviewing" || (d.note && d.note.length >= 3), {
      message: "Give a note explaining the decision (at least 3 characters)",
      path: ["note"],
    }),
});

export const reviewAppealSchema = z.object({
  params: idParam,
  body: z.object({ decision: z.enum(["upheld", "overturned"]), response: reason }),
});