import { asyncHandler } from "../utils/asyncHandler.js";
import { Session, User } from "../models/index.js";
import { verifyAccessToken } from "../services/token.service.js";

export const optionalAuth = asyncHandler(async (req, res, next) => {
  try {
    const header = req.headers.authorization;
    const token = req.cookies?.accessToken || (header?.startsWith("Bearer ") ? header.slice(7) : null);
    if (token) {
      const payload = verifyAccessToken(token);
      const session = await Session.exists({
        _id: payload.sid,
        user: payload.sub,
        revokedAt: null,
        expiresAt: { $gt: new Date() },
      });
      if (session) {
        const user = await User.findOne({ _id: payload.sub, status: "active", deletedAt: { $exists: false } });
        if (user) req.user = user;
      }
    }
  } catch {
    // an invalid or expired token simply means "treat as a guest"
  }
  next();
});