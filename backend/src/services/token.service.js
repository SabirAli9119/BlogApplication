import jwt from "jsonwebtoken";
import crypto from "crypto";
import { env } from "../config/env.js";

// Keyed hash: even with a leaked database, tokens can't be recomputed without the secret.
export const hashToken = (token) =>
  crypto.createHmac("sha256", env.jwt.refreshSecret).update(token).digest("hex");

export const generateOpaqueToken = (bytes = 48) => {
  const token = crypto.randomBytes(bytes).toString("hex");
  return { token, hash: hashToken(token) };
};

// The token only says WHO (sub) and WHICH SESSION (sid). The role is always read from the DB.
export const signAccessToken = ({ userId, sessionId }) =>
  jwt.sign({ sid: String(sessionId) }, env.jwt.accessSecret, {
    subject: String(userId),
    expiresIn: env.jwt.accessExpires,
  });

export const verifyAccessToken = (token) => jwt.verify(token, env.jwt.accessSecret);

const UNITS = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
export const durationToMs = (str) => {
  const match = /^(\d+)([smhd])$/.exec(str);
  if (!match) throw new Error(`Invalid duration: ${str}`);
  return Number(match[1]) * UNITS[match[2]];
};