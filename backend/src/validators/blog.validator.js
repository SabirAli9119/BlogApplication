import { z } from "zod";

const objectId = z.string().regex(/^[a-f\d]{24}$/i, "Invalid id");
const isoDate = z.string().refine((s) => !Number.isNaN(Date.parse(s)), "Invalid date");

/* ---------- public listing (Phase 7) ---------- */

export const listBlogsSchema = z.object({
  query: z.object({
    page: z.coerce.number().int().min(1).max(10000).optional(),
    limit: z.coerce.number().int().min(1).max(50).optional(),
    q: z.string().trim().max(100).optional(),
    category: z.string().trim().toLowerCase().max(60).optional(),
    tag: z.string().trim().toLowerCase().max(30).optional(),
    author: z.string().trim().toLowerCase().max(20).optional(),
    sort: z.enum(["latest", "popular", "relevance"]).optional(),
  }),
});

export const limitSchema = z.object({
  query: z.object({ limit: z.coerce.number().int().min(1).max(20).optional() }),
});

export const suggestionsSchema = z.object({
  query: z.object({ q: z.string().trim().min(2, "Type at least 2 characters").max(50) }),
});

/* ---------- author area (Phase 8) ---------- */

const tagRule = z
  .string()
  .trim()
  .toLowerCase()
  .min(1)
  .max(30)
  .regex(/^[\p{L}\p{N}][\p{L}\p{N} _-]*$/u, "Tags can contain letters, numbers, spaces and hyphens")
  .transform((s) => s.replace(/[\s_]+/g, "-"));

// Only these fields can ever be set by the client. Everything else is stripped.
export const postFields = {
  title: z.string().trim().max(150, "Title is too long (max 150 characters)").optional(),
  description: z.string().trim().max(300, "Description is too long (max 300 characters)").optional(),
  content: z.string().max(300000, "Post is too long").optional(),
  categories: z.array(objectId).max(5, "Choose up to 5 categories").optional(),
  tags: z.array(tagRule).max(10, "Use up to 10 tags").optional(),
  seo: z
    .object({
      title: z.string().trim().max(70).optional(),
      description: z.string().trim().max(160).optional(),
    })
    .optional(),
};

export const idParamSchema = z.object({ params: z.object({ id: objectId }) });

export const createBlogSchema = z.object({ body: z.object(postFields).default({}) });

export const updateBlogSchema = z.object({
  params: z.object({ id: objectId }),
  body: z.object({
    ...postFields,
    expectedUpdatedAt: isoDate.optional(),
    autosave: z.boolean().optional(),
  }),
});

export const statusSchema = z.object({
  params: z.object({ id: objectId }),
  body: z
    .object({
      status: z.enum(["draft", "published", "scheduled", "unpublished"]),
      scheduledFor: isoDate.optional(),
    })
    .refine((d) => d.status !== "scheduled" || Boolean(d.scheduledFor), {
      message: "Choose a date and time",
      path: ["scheduledFor"],
    }),
});

export const myBlogsSchema = z.object({
  query: z.object({
    page: z.coerce.number().int().min(1).max(10000).optional(),
    limit: z.coerce.number().int().min(1).max(50).optional(),
    status: z.enum(["draft", "scheduled", "published", "unpublished", "removed"]).optional(),
    q: z.string().trim().max(100).optional(),
  }),
});