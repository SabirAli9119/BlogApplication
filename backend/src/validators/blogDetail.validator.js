import { z } from "zod";

const objectId = z.string().regex(/^[a-f\d]{24}$/i, "Invalid id");

export const slugParamSchema = z.object({
  params: z.object({
    slug: z.string().trim().toLowerCase().min(3).max(120).regex(/^[a-z0-9-]+$/, "Invalid post link"),
  }),
});

export const relatedSchema = z.object({
  params: z.object({ id: objectId }),
  query: z.object({ limit: z.coerce.number().int().min(1).max(12).optional() }),
});