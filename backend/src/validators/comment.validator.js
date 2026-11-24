import { z } from "zod";

const objectId = z.string().regex(/^[a-f\d]{24}$/i, "Invalid id");
const paging = {
  page: z.coerce.number().int().min(1).max(10000).optional(),
  limit: z.coerce.number().int().min(1).max(30).optional(),
};

export const listCommentsSchema = z.object({
  params: z.object({ id: objectId }),
  query: z.object({ ...paging, sort: z.enum(["newest", "oldest"]).optional() }),
});

export const createCommentSchema = z.object({
  params: z.object({ id: objectId }),
  body: z.object({
    content: z.string().trim().min(1, "Write something first").max(2000, "Comments can be up to 2000 characters"),
    parentId: objectId.optional(),
  }),
});

export const listRepliesSchema = z.object({
  params: z.object({ id: objectId }),
  query: z.object(paging),
});

export const commentIdParamSchema = z.object({ params: z.object({ id: objectId }) });