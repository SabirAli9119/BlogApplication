import { asyncHandler } from "../utils/asyncHandler.js";
import { sendSuccess } from "../utils/ApiResponse.js";
import * as svc from "../services/bookmark.service.js";

export const list = asyncHandler(async (req, res) => {
  const { items, meta } = await svc.listBookmarks({ user: req.user, query: req.validated.query });
  sendSuccess(res, items, "Bookmarks fetched", 200, meta);
});

export const add = asyncHandler(async (req, res) => {
  sendSuccess(res, await svc.addBookmark({ user: req.user, blogId: req.validated.params.blogId }), "Bookmarked");
});

export const remove = asyncHandler(async (req, res) => {
  sendSuccess(res, await svc.removeBookmark({ user: req.user, blogId: req.validated.params.blogId }), "Bookmark removed");
});