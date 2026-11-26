import mongoose from "mongoose";
import { env } from "../config/env.js";
import { User, UserPreference, Notification, ActivityLog, LoginHistory, Session } from "../models/index.js";

export const PASSWORD = "Str0ng!Pass1";
export const GHOST_ID = "507f1f77bcf86cd799439011";

// Everything the check scripts have in common: HTTP calls, test users, cleanup.
export const makeKit = () => {
  const API = `http://localhost:${env.port}/api`;
  const tag = Date.now().toString(36);
  const P = `t${tag}_`; // every test username and email starts with this
  const users = [];
  let passed = 0;

  const check = (condition, label) => {
    if (!condition) throw new Error(`FAILED: ${label}`);
    passed++;
    console.log(`✅ ${label}`);
  };

  const call = async (cookie, method, path, json) => {
    const headers = {};
    if (cookie) headers.cookie = cookie;
    let body;
    if (json !== undefined) { headers["content-type"] = "application/json"; body = JSON.stringify(json); }
    const res = await fetch(`${API}${path}`, { method, headers, body });
    return { status: res.status, data: await res.json().catch(() => null) };
  };

  const mkUser = async (name, extra = {}) => {
    const user = await User.create({
      firstName: "Chk", lastName: name, username: `${P}${name}`, email: `${P}${name}@example.com`,
      password: PASSWORD, dateOfBirth: new Date("1995-01-01"), gender: "other", ...extra,
    });
    await UserPreference.create({ user: user._id, consent: { termsAcceptedAt: new Date(), privacyAcceptedAt: new Date() } });
    users.push(user);
    return user;
  };

  const loginRaw = async (user, password = PASSWORD) => {
    const res = await fetch(`${API}/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ identifier: user.username, password }),
    });
    const body = await res.json().catch(() => ({}));
    return {
      status: res.status,
      code: body.code,
      cookie: res.headers.getSetCookie().find((c) => c.startsWith("accessToken="))?.split(";")[0],
    };
  };
  const login = async (user) => (await loginRaw(user)).cookie;

  const cleanupUsers = async () => {
    const ids = users.map((u) => u._id);
    await Promise.all([
      Notification.deleteMany({ recipient: { $in: ids } }),
      UserPreference.deleteMany({ user: { $in: ids } }),
      Session.deleteMany({ user: { $in: ids } }),
      LoginHistory.deleteMany({ $or: [{ user: { $in: ids } }, { identifier: { $regex: `^${P}` } }] }),
      ActivityLog.deleteMany({ user: { $in: ids } }),
      User.deleteMany({ _id: { $in: ids } }),
      // the audit log blocks deletes inside the app, so tests clean up with the raw driver (tests only)
      mongoose.connection.collection("adminauditlogs").deleteMany({
        $or: [{ admin: { $in: ids } }, { targetUser: { $in: ids } }],
      }),
    ]);
  };

  return { API, tag, P, users, check, call, mkUser, loginRaw, login, cleanupUsers, done: () => console.log(`\nAll ${passed} checks passed 🎉`) };
};