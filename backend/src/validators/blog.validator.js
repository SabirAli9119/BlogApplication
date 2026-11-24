import { z } from "zod";

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