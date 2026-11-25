import { asyncHandler } from "../utils/asyncHandler.js";
import { sendSuccess } from "../utils/ApiResponse.js";
import { getDeviceInfo } from "../utils/deviceParser.js";
import { clearAuthCookies } from "../utils/cookies.js";
import * as accountService from "../services/account.service.js";

export const list = asyncHandler(async (req, res) => {
  const sessions = await accountService.listSessions({ user: req.user, currentSessionId: req.session._id });
  sendSuccess(res, sessions, "Sessions fetched");
});

export const terminate = asyncHandler(async (req, res) => {
  const ended = await accountService.terminateSession({
    user: req.user,
    sessionId: req.validated.params.sessionId,
    device: getDeviceInfo(req),
  });
  // ending the session you are using is a logout
  if (String(ended._id) === String(req.session._id)) clearAuthCookies(res);
  sendSuccess(res, null, "Session ended");
});