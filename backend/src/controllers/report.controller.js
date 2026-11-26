import { asyncHandler } from "../utils/asyncHandler.js";
import { sendSuccess } from "../utils/ApiResponse.js";
import * as svc from "../services/report.service.js";

export const create = asyncHandler(async (req, res) => {
  const report = await svc.createReport({ user: req.user, input: req.body });
  sendSuccess(res, { report }, "Report received. Thank you.", 201);
});

export const mine = asyncHandler(async (req, res) => {
  const { items, meta } = await svc.listMyReports({ user: req.user, query: req.validated.query });
  sendSuccess(res, items, "Your reports fetched", 200, meta);
});

export const appeal = asyncHandler(async (req, res) => {
  // logged-in users appeal directly; suspended or banned users prove who they are with email and password
  const user = req.user || (await svc.authenticateForAppeal(req.body));
  const data = await svc.submitAppeal({ user, reportId: req.validated.params.id, message: req.body.message });
  sendSuccess(res, data, "Appeal submitted");
});