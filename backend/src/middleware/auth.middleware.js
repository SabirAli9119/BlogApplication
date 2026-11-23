import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { Session, User } from "../models/index.js";
import { verifyAccessToken } from "../services/token.service.js";
import { assertAccountActive } from "../services/auth.service.js";

const extractToken = (req) => {
  if (req.cookies?.accessToken) return req.cookies.accessToken;
  const header = req.headers.authorization;
  return header?.startsWith("Bearer ") ? header.slice(7) : null;
};

export const authenticate = asyncHandler(async (req, res, next) => {
  const token = extractToken(req);
  if (!token) throw ApiError.unauthorized("Authentication required", "NO_TOKEN");

  let payload;
  try {
    payload = verifyAccessToken(token);
  } catch (err) {
    const expired = err.name === "TokenExpiredError";
    throw ApiError.unauthorized(expired ? "Access token expired" : "Invalid token", expired ? "TOKEN_EXPIRED" : "INVALID_TOKEN");
  }

  // The JWT alone isn't enough: the session must still exist, so logout/revoke work instantly.
  const session = await Session.findOne({
    _id: payload.sid,
    user: payload.sub,
    revokedAt: null,
    expiresAt: { $gt: new Date() },
  });
  if (!session) throw ApiError.unauthorized("Session is no longer valid", "SESSION_INVALID");

  const user = await User.findOne({ _id: payload.sub, deletedAt: { $exists: false } });
  if (!user) throw ApiError.unauthorized("Account not found", "SESSION_INVALID");
  await assertAccountActive(user);

  if (Date.now() - session.lastActiveAt.getTime() > 5 * 60 * 1000) {
    await Session.updateOne({ _id: session._id }, { lastActiveAt: new Date() });
  }

  req.user = user; // role and status always come from the database
  req.session = session;
  next();
});