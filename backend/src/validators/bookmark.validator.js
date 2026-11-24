import { z } from "zod";

const objectId = z.string().regex(/^[a-f\d]{24}$/i, "Invalid id");

export const blogIdParamSchema = z.object({ params: z.object({ blogId: objectId }) });

export const listBookmarksSchema = z.object({
  query: z.object({
    page: z.coerce.number().int().min(1).max(10000).optional(),
    limit: z.coerce.number().int().min(1).max(50).optional(),
  }),
});