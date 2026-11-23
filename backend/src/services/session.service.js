import crypto from "crypto";
import { Session } from "../models/index.js";
import { env } from "../config/env.js";
import { generateOpaqueToken, durationToMs, hashToken } from "./token.service.js";

const newExpiry = () => new Date(Date.now() + durationToMs(env.jwt.refreshExpires));

export const createSession = async (userId, device) => {
  const { token, hash } = generateOpaqueToken();
  const session = await Session.create({
    user: userId,
    refreshTokenHash: hash,
    family: crypto.randomUUID(),
    deviceType: device.deviceType,
    browser: device.browser,
    os: device.os,
    ip: device.ip,
    approxLocation: device.approxLocation || undefined,
    expiresAt: newExpiry(),
  });
  return { session, refreshToken: token };
};

/**
 * Swap the refresh token for a new one (rotation).
 * Returns { status: "ok" | "reuse" | "invalid", session?, refreshToken? }
 */
export const rotateSession = async (rawToken) => {
  const oldHash = hashToken(rawToken);
  const { token, hash: newHash } = generateOpaqueToken();

  // One atomic step: only one request can win with a given token.
  const session = await Session.findOneAndUpdate(
    { refreshTokenHash: oldHash, revokedAt: null, expiresAt: { $gt: new Date() } },
    {
      $set: {
        refreshTokenHash: newHash,
        previousRefreshTokenHash: oldHash,
        lastActiveAt: new Date(),
        expiresAt: newExpiry(),
      },
    },
    { returnDocument: "after" }
  );
  if (session) return { status: "ok", session, refreshToken: token };

  // An already-used token came back: someone may have stolen it. Kill the session.
  const reused = await Session.findOne({ previousRefreshTokenHash: oldHash, revokedAt: null });
  if (reused) {
    await revokeSession(reused._id, "token_reuse");
    return { status: "reuse", session: reused };
  }
  return { status: "invalid" };
};

export const revokeSession = (sessionId, reason) =>
  Session.updateOne({ _id: sessionId, revokedAt: null }, { revokedAt: new Date(), revokedReason: reason });

export const revokeAllSessions = (userId, reason, exceptSessionId) =>
  Session.updateMany(
    { user: userId, revokedAt: null, ...(exceptSessionId && { _id: { $ne: exceptSessionId } }) },
    { revokedAt: new Date(), revokedReason: reason }
  );