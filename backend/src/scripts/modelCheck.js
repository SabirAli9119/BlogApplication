import mongoose from "mongoose";
import { connectDB, disconnectDB } from "../config/db.js";
import * as M from "../models/index.js";

const tag = Date.now().toString(36);
let passed = 0;

const check = (condition, label) => {
  if (!condition) throw new Error(`FAILED: ${label}`);
  passed++;
  console.log(`✅ ${label}`);
};

const rejects = async (fn) => {
  try { await fn(); return false; } catch { return true; }
};

const run = async () => {
  await connectDB();
  let user;

  try {
    const models = Object.values(M);
    for (const model of models) await model.syncIndexes();
    check(models.length === 19, `${models.length} models loaded and indexes synced`);

    user = await M.User.create({
      firstName: "Test", lastName: "User", username: `test_${tag}`,
      email: `test_${tag}@example.com`, password: "Test@1234",
      dateOfBirth: new Date("2000-01-01"), gender: "male",
    });

    const withPw = await M.User.findById(user._id).select("+password");
    check(withPw.password !== "Test@1234", "password is stored hashed");
    check(await withPw.comparePassword("Test@1234"), "correct password matches");
    check(!(await withPw.comparePassword("wrong")), "wrong password is rejected");
    check(!("password" in user.toJSON()), "password never appears in JSON output");

    check(
      await rejects(() => M.User.create({
        firstName: "A", lastName: "B", username: `test_${tag}`,
        email: `other_${tag}@example.com`, password: "Test@1234",
        dateOfBirth: new Date("2000-01-01"), gender: "male",
      })),
      "duplicate username is rejected"
    );

    check(
      await rejects(() => M.User.create({
        firstName: "Kid", lastName: "User", username: `kid_${tag}`,
        email: `kid_${tag}@example.com`, password: "Test@1234",
        dateOfBirth: new Date(), gender: "other",
      })),
      "under-13 date of birth is rejected"
    );

    const pref = await M.UserPreference.create({
      user: user._id,
      consent: { termsAcceptedAt: new Date(), privacyAcceptedAt: new Date() },
    });
    check(pref.privacy.allowLocationSharing === false, "privacy defaults are safe (location off)");

    const blog = await M.Blog.create({
      author: user._id, title: "Hello", slug: `hello-${tag}`, description: "test",
    });
    check(blog.status === "draft", "new blog defaults to draft");

    check(
      await rejects(() => M.Follow.create({ follower: user._id, following: user._id })),
      "following yourself is rejected"
    );

    const log = await M.AdminAuditLog.create({
      admin: user._id, action: "modelCheck", reason: `modelCheck-${tag}`,
    });
    check(
      await rejects(() => M.AdminAuditLog.updateOne({ _id: log._id }, { reason: "tampered" })),
      "audit log update is blocked"
    );
    log.reason = "tampered";
    check(await rejects(() => log.save()), "audit log re-save is blocked");
    check(await rejects(() => M.AdminAuditLog.deleteMany({ reason: `modelCheck-${tag}` })), "audit log delete is blocked");

    console.log(`\nAll ${passed} checks passed 🎉`);
  } finally {
    if (user) {
      await Promise.all([
        M.User.deleteOne({ _id: user._id }),
        M.UserPreference.deleteMany({ user: user._id }),
        M.Blog.deleteMany({ author: user._id }),
        // raw driver: test cleanup is the only place we bypass the immutability hooks
        mongoose.connection.collection("adminauditlogs").deleteMany({ admin: user._id }),
      ]);
    }
    await disconnectDB();
  }
};

run().catch((err) => {
  console.error(err.message);
  process.exit(1);
});