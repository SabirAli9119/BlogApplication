import { connectDB, disconnectDB } from "../config/db.js";
import { env } from "../config/env.js";
import {
  User, UserPreference, Category, Blog, Follow, Notification, Session, LoginHistory, ActivityLog, ReadingHistory,
} from "../models/index.js";
import { deleteImage } from "../services/upload.service.js";

const API = `http://localhost:${env.port}/api`;
const tag = Date.now().toString(36);
const PASSWORD = "Str0ng!Pass1";
const NEW_PASSWORD = "N3w!Passw0rd";
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64"
);
let passed = 0;

const check = (condition, label) => {
  if (!condition) throw new Error(`FAILED: ${label}`);
  passed++;
  console.log(`✅ ${label}`);
};

const request = async (cookie, method, path, { json, form, headers = {} } = {}) => {
  const h = { ...headers };
  if (cookie) h.cookie = cookie;
  let body;
  if (json !== undefined) { h["content-type"] = "application/json"; body = JSON.stringify(json); }
  if (form) body = form;
  const res = await fetch(`${API}${path}`, { method, headers: h, body });
  return { status: res.status, data: await res.json().catch(() => null) };
};
const get = (cookie, path, ua) => request(cookie, "GET", path, { headers: ua ? { "user-agent": ua } : {} });
const post = (cookie, path, json = {}) => request(cookie, "POST", path, { json });
const del = (cookie, path, json) => request(cookie, "DELETE", path, json === undefined ? {} : { json });
const put = (cookie, path, json) => request(cookie, "PUT", path, { json });

const imageForm = (field, bytes = PNG, type = "image/png") => {
  const form = new FormData();
  form.append(field, new Blob([bytes], { type }), "file.png");
  return form;
};

const mkUser = async (name, { status, isPrivate, extra = {} } = {}) => {
  const user = await User.create({
    firstName: "Chk", lastName: name, username: `${name}_${tag}`, email: `${name}_${tag}@example.com`,
    password: PASSWORD, dateOfBirth: new Date("1995-01-01"), gender: "other", ...(status && { status }), ...extra,
  });
  await UserPreference.create({
    user: user._id,
    privacy: { profileVisibility: isPrivate ? "private" : "public" },
    consent: { termsAcceptedAt: new Date(), privacyAcceptedAt: new Date() },
  });
  return user;
};

const login = async (user, ua = "TestBrowser/1", password = PASSWORD) => {
  const res = await fetch(`${API}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": ua },
    body: JSON.stringify({ identifier: user.username, password }),
  });
  return res.headers.getSetCookie().find((c) => c.startsWith("accessToken="))?.split(";")[0];
};

const run = async () => {
  await connectDB();
  const users = [];
  const blogIds = [];
  let category;

  try {
    const A = await mkUser("owner", {
      extra: {
        bio: "Original bio", headline: "Original headline",
        contact: { country: "India", state: "Karnataka", city: "Bengaluru", postalCode: "560001", timezone: "Asia/Kolkata" },
      },
    });
    const B = await mkUser("fan");
    const C = await mkUser("second");
    const D = await mkUser("lurker");
    const P = await mkUser("private", { isPrivate: true, extra: { bio: "secret bio", headline: "secret headline" } });
    const Z = await mkUser("suspended", { status: "suspended" });
    const E = await mkUser("account");
    users.push(A, B, C, D, P, Z, E);
    const [ca, cb, cc, cd, cp] = await Promise.all([A, B, C, D, P].map((u) => login(u)));
    check([ca, cb, cc, cd, cp].every(Boolean), "test users can log in");

    category = await Category.create({ name: `User ${tag}`, slug: `user-${tag}` });
    let n = 0;
    const mkBlog = async (author, extra = {}) => {
      const blog = await Blog.create({
        author: author._id, title: `User post ${++n} ${tag}`, slug: `user-post-${n}-${tag}`, description: "check",
        content: "<p>Body text of the post.</p>", categories: [category._id], tags: [`tg${tag}`],
        status: "published", publishedAt: new Date(Date.now() - 3600000), readingTime: 1, ...extra,
      });
      blogIds.push(blog._id);
      return blog;
    };
    const b1 = await mkBlog(A, { likesCount: 3, views: 10 });
    const b2 = await mkBlog(A, { likesCount: 2, views: 5 });
    const b3 = await mkBlog(A, { likesCount: 0, views: 1, isFeatured: true, featuredAt: new Date() });
    await mkBlog(A, { likesCount: 1, views: 7 });
    await mkBlog(A, { status: "draft", publishedAt: undefined, views: 999 });
    const profileOf = async (cookie, who) => (await get(cookie, `/users/${who}`)).data.data.profile;

    // ---------- public profile ----------
    let r = await get(null, `/users/${A.username}`);
    let p = r.data.data.profile;
    check(r.status === 200 && p.username === A.username && p.bio === "Original bio" && p.joinedAt, "a public profile can be read without logging in");
    check(!["email", "dateOfBirth", "password", "contact", "status", "role", "gender", "isPrivate"].some((k) => k in p), "private fields are never exposed");
    check(p.stats.articles === 4 && p.stats.likes === 6 && p.stats.views === 23, "stats count only published posts");
    check(
      p.featuredArticles.length === 3 && p.featuredArticles[0]._id === String(b3._id) && p.featuredArticles.every((x) => !("content" in x)),
      "featured articles list platform-featured posts first, then the most viewed"
    );
    check(!("location" in p), "location is hidden by default");
    check((await profileOf(null, A._id)).username === A.username, "a profile can also be opened by user id");
    check((await get(null, `/users/${Z.username}`)).status === 404, "a suspended user's profile is hidden");
    check((await get(null, "/users/nobody_here_xyz")).status === 404, "an unknown user gives 404");
    check((await get(null, "/users/bad%20name!")).status === 422, "an invalid identifier is rejected");

    await UserPreference.updateOne({ user: A._id }, { "privacy.showCountryPublic": true });
    p = await profileOf(null, A.username);
    check(p.location.country === "India" && !("city" in p.location), "the country appears once the user shares it");
    await UserPreference.updateOne({ user: A._id }, { "privacy.showCityPublic": true });
    p = await profileOf(null, A.username);
    check(
      p.location.city === "Bengaluru" && !JSON.stringify(p).includes("560001") && !JSON.stringify(p).includes("Karnataka") && !JSON.stringify(p).includes("Kolkata"),
      "state, postal code and time zone are never public"
    );
    check(!("lastActiveAt" in p), "last active is hidden by default");
    await UserPreference.updateOne({ user: A._id }, { "privacy.showActivity": true });
    check("lastActiveAt" in (await profileOf(null, A.username)), "last active appears when the user allows it");
    await UserPreference.updateOne(
      { user: A._id },
      { "blogging.favoriteCategories": [category._id], "blogging.topics": ["node"] }
    );
    p = await profileOf(null, A.username);
    check(p.interests.categories[0].slug === `user-${tag}` && p.interests.topics[0] === "node", "favorite categories and topics are shown");

    // ---------- private profile ----------
    p = await profileOf(null, P.username);
    check(p.isPrivate === true && !("stats" in p) && !JSON.stringify(p).includes("secret"), "a private profile shows only a name and picture");
    check(p.viewer.canFollow === false, "a private profile cannot be followed");
    p = await profileOf(cp, P.username);
    check(p.isPrivate === true && Boolean(p.stats) && p.bio === "secret bio", "the owner sees their full private profile");
    p = await profileOf(cb, A.username);
    check(p.viewer.canFollow === true && p.viewer.isFollowing === false && p.viewer.isSelf === false, "viewer flags work for a logged-in visitor");
    check((await profileOf(ca, A.username)).viewer.isSelf === true, "viewer flags know it is your own profile");

    // ---------- follow ----------
    const followNotes = () => Notification.countDocuments({ recipient: A._id, type: "new_follower", sender: B._id });
    check((await post(null, `/users/${A.username}/follow`)).status === 401, "following requires login");
    r = await post(cb, `/users/${A.username}/follow`);
    check(r.status === 200 && r.data.data.following === true && r.data.data.followersCount === 1, "a user can be followed");
    check(
      (await User.findById(A._id)).followersCount === 1 && (await User.findById(B._id)).followingCount === 1,
      "both counters are updated"
    );
    await post(cb, `/users/${A.username}/follow`);
    check((await User.findById(A._id)).followersCount === 1 && (await Follow.countDocuments({ follower: B._id, following: A._id })) === 1, "following twice does not double count");
    check((await followNotes()) === 1, "the user is notified of the new follower");

    check((await post(ca, `/users/${A.username}/follow`)).status === 400, "you cannot follow yourself");
    r = await post(cb, `/users/${P.username}/follow`);
    check(r.status === 403 && r.data.code === "PROFILE_PRIVATE", "a private profile cannot be followed");
    await UserPreference.updateOne({ user: C._id }, { "privacy.allowFollowers": false });
    r = await post(cb, `/users/${C.username}/follow`);
    check(r.status === 403 && r.data.code === "FOLLOWERS_DISABLED", "users who disabled followers cannot be followed");
    await UserPreference.updateOne({ user: C._id }, { "privacy.allowFollowers": true });
    check((await post(cb, `/users/${Z.username}/follow`)).status === 404, "a suspended user cannot be followed");

    await Promise.all(Array.from({ length: 5 }, () => post(cc, `/users/${A._id}/follow`)));
    check(
      (await User.findById(A._id)).followersCount === 2 && (await Follow.countDocuments({ follower: C._id, following: A._id })) === 1,
      "five simultaneous follows count exactly once (follow by id works too)"
    );

    r = await del(cb, `/users/${A.username}/follow`);
    check(r.data.data.following === false && r.data.data.followersCount === 1, "a user can be unfollowed");
    r = await del(cb, `/users/${A.username}/follow`);
    check(r.status === 200 && !("followersCount" in r.data.data), "unfollowing twice is harmless");
    r = await post(cb, `/users/${A.username}/follow`);
    check(r.data.data.followersCount === 2 && (await followNotes()) === 1, "follow, unfollow, follow again sends only one notification");
    await post(cd, `/users/${A.username}/follow`);
    await post(cb, `/users/${C.username}/follow`);
    check((await User.findById(A._id)).followersCount === 3, "the follower counter tracks every follower");

    // ---------- follower and following lists ----------
    await User.updateOne({ _id: D._id }, { status: "suspended" });
    r = await get(cb, `/users/${A.username}/followers?limit=1&page=1`);
    check(r.status === 200 && r.data.data.length === 1 && r.data.meta.total === 2 && r.data.meta.hasNext, "followers are listed with pagination (suspended users excluded)");
    check(r.data.data[0].username === B.username && r.data.data[0].isSelf === true, "the newest follower comes first and is marked as you");
    r = await get(cb, `/users/${A.username}/followers?limit=1&page=2`);
    check(r.data.data[0].username === C.username && r.data.data[0].isFollowing === true, "the list shows whether you follow each person");
    check(!JSON.stringify(r.data).includes("@example.com"), "list entries hold no private data");
    r = await get(null, `/users/${B.username}/following`);
    check(
      r.data.data.map((x) => x.username).sort().join() === [A.username, C.username].sort().join(),
      "the following list is correct"
    );
    check((await get(null, `/users/${P.username}/followers`)).data.code === "PROFILE_PRIVATE", "a private profile's lists are closed to others");
    check((await get(cp, `/users/${P.username}/followers`)).status === 200, "the owner can open their own lists");
    check((await get(null, "/users/nobody_here_xyz/followers")).status === 404, "lists of an unknown user give 404");

    // ---------- editing the profile ----------
    check((await put(null, "/users/profile", { bio: "x" })).status === 401, "editing the profile requires login");
    r = await put(ca, "/users/profile", {
      firstName: "  New  ", bio: "<b>Hello</b> <script>x</script>there", headline: "Developer", contact: { city: "Delhi" },
      role: "super_admin", username: "hacked", email: "evil@example.com", followersCount: 999, isVerifiedBadge: true, status: "banned",
    });
    check(r.status === 200 && r.data.data.user.firstName === "New" && r.data.data.user.bio === "Hello there", "the profile can be edited and text is cleaned");
    const fresh = await User.findById(A._id);
    check(
      fresh.role === "user" && fresh.username === A.username && fresh.email === A.email &&
        fresh.followersCount !== 999 && !fresh.isVerifiedBadge && fresh.status === "active",
      "role, username, email, counters and flags cannot be changed (mass assignment blocked)"
    );
    check(fresh.contact.city === "Delhi" && fresh.contact.country === "India", "contact updates are partial");
    check((await put(ca, "/users/profile", { bio: "a".repeat(301) })).status === 422, "a bio over 300 characters is rejected");
    check((await put(ca, "/users/profile", { firstName: "" })).status === 422, "an empty first name is rejected");
    check((await put(ca, "/users/profile", { firstName: "<b></b>" })).status === 422, "a first name that is empty after cleaning is rejected");
    check((await ActivityLog.countDocuments({ user: A._id, event: "profile_update" })) >= 1, "profile updates are logged");

    // ---------- pictures ----------
    r = await request(ca, "PUT", "/users/profile/avatar", { form: imageForm("avatar") });
    check(r.status === 200 && Boolean(r.data.data.avatar.url) && !("publicId" in r.data.data.avatar), "an avatar can be uploaded");
    const firstAvatar = (await User.findById(A._id)).avatar.publicId;
    await request(ca, "PUT", "/users/profile/avatar", { form: imageForm("avatar") });
    check((await User.findById(A._id)).avatar.publicId !== firstAvatar, "replacing the avatar stores the new one");
    check((await profileOf(null, A.username)).avatar.url, "the avatar shows on the profile");
    r = await request(ca, "PUT", "/users/profile/avatar", { form: imageForm("avatar", Buffer.from("not an image at all")) });
    check(r.status === 400, "a fake image is rejected");
    r = await request(ca, "PUT", "/users/profile/avatar", { json: {} });
    check(r.status === 400, "uploading without a file is rejected");
    check((await del(ca, "/users/profile/avatar")).status === 200 && !(await User.findById(A._id)).avatar?.url, "the avatar can be removed");
    const firstCover = (await User.findById(A._id)).coverPicture?.publicId;
    r = await request(ca, "PUT", "/users/profile/cover", { form: imageForm("coverPicture") });
    check(r.status === 200 && Boolean(r.data.data.coverPicture.url) && (await User.findById(A._id)).coverPicture.publicId !== firstCover, "the cover picture can be replaced");

    // ---------- reading history ----------
    check((await get(null, "/users/me/reading-history")).status === 401, "reading history requires login");
    await get(cb, `/blogs/${b1.slug}`, "TestBrowser/h1");
    await get(cb, `/blogs/${b2.slug}`, "TestBrowser/h1");
    r = await get(cb, "/users/me/reading-history");
    check(
      r.status === 200 && r.data.meta.total === 2 && r.data.data[0]._id === String(b2._id) && r.data.data[0].readAt && r.data.data.every((x) => !("content" in x)),
      "reading history lists read posts, newest first"
    );
    await Blog.updateOne({ _id: b1._id }, { status: "unpublished" });
    check((await get(cb, "/users/me/reading-history")).data.meta.total === 1, "posts that are no longer public leave the history");
    await Blog.updateOne({ _id: b1._id }, { status: "published" });
    check((await get(cc, "/users/me/reading-history")).data.meta.total === 0, "users only see their own history");
    check((await del(cb, `/users/me/reading-history/${b2._id}`)).status === 200, "one post can be removed from the history");
    check((await get(cb, "/users/me/reading-history")).data.data.map((x) => x._id).join() === String(b1._id), "the removed post is gone");
    r = await del(cb, "/users/me/reading-history");
    check(r.status === 200 && r.data.data.deleted === 1 && (await get(cb, "/users/me/reading-history")).data.meta.total === 0, "the whole history can be cleared");

    // ---------- sessions ----------
    // const [e1, e2, e3, e4] = [];
    const sessionCookies = [];
    for (let i = 1; i <= 4; i++) sessionCookies.push(await login(E, `SessionTest/${i}`));
    //[e1, e2, e3, e4].length;
    const [s1, s2, s3, s4] = sessionCookies;
    check((await get(null, "/users/me/sessions")).status === 401, "the sessions list requires login");
    r = await get(s1, "/users/me/sessions");
    check(r.status === 200 && r.data.data.length === 4 && r.data.data.filter((s) => s.isCurrent).length === 1, "active sessions are listed and the current one is marked");
    check(
      r.data.data.every((s) => s.browser && s.os && s.deviceType && s.loginAt && s.lastActiveAt && !("refreshTokenHash" in s) && !("ip" in s)),
      "sessions show device details but no tokens or addresses"
    );
    const currentId = async (cookie) => (await get(cookie, "/users/me/sessions")).data.data.find((s) => s.isCurrent)._id;
    const [id1, id2] = [await currentId(s1), await currentId(s2)];
    const bSession = await Session.findOne({ user: B._id });
    check((await del(s1, `/users/me/sessions/${bSession._id}`)).status === 404, "another user's session cannot be ended");
    check((await del(s1, `/users/me/sessions/${id2}`)).status === 200, "another device can be signed out");
    check((await get(s2, "/auth/me")).status === 401, "the signed-out device loses access immediately");
    check((await del(s1, `/users/me/sessions/${id1}`)).status === 200 && (await get(s1, "/auth/me")).status === 401, "ending the current session logs you out");

    // ---------- password change ----------
    const change = (current, next, confirm = next) =>
      put(s3, "/users/password", { currentPassword: current, newPassword: next, confirmPassword: confirm });
    r = await change("Wrong!Pass1", NEW_PASSWORD);
    check(r.status === 400 && r.data.code === "WRONG_PASSWORD", "a wrong current password is rejected (400, not 401)");
    check((await change(PASSWORD, PASSWORD)).status === 400, "reusing the same password is rejected");
    check((await change(PASSWORD, "weak")).status === 422, "a weak new password is rejected");
    check((await change(PASSWORD, NEW_PASSWORD, "Different1!")).status === 422, "mismatched confirmation is rejected");
    check((await change(PASSWORD, `${E.username}A1!zz`)).status === 422, "a password containing the username is rejected");
    check((await change(PASSWORD, NEW_PASSWORD)).status === 200, "the password can be changed");
    check((await get(s4, "/auth/me")).status === 401, "other devices are signed out after a password change");
    check((await get(s3, "/auth/me")).status === 200, "the current device stays signed in");
    check(!(await login(E, "SessionTest/9", PASSWORD)), "the old password no longer works");
    const s5 = await login(E, "SessionTest/5", NEW_PASSWORD);
    check(Boolean(s5), "the new password works");
    check((await Notification.countDocuments({ recipient: E._id, type: "security_alert" })) >= 1, "a security notification is created");

    // ---------- account deletion ----------
    await mkBlog(E);
    await post(s5, `/users/${A.username}/follow`);
    await post(cb, `/users/${E.username}/follow`);
    const aBefore = (await User.findById(A._id)).followersCount;
    const bBefore = (await User.findById(B._id)).followingCount;
    check((await del(null, "/users/account", { password: NEW_PASSWORD })).status === 401, "deleting an account requires login");
    check((await del(s5, "/users/account", {})).status === 422, "deleting requires the password");
    r = await del(s5, "/users/account", { password: "Wrong!Pass1" });
    check(r.status === 400 && r.data.code === "WRONG_PASSWORD", "a wrong password does not delete the account");
    check((await del(s5, "/users/account", { password: NEW_PASSWORD })).status === 200, "an account can be deleted");
    check((await get(s5, "/auth/me")).status === 401 && (await get(s3, "/auth/me")).status === 401, "every session of a deleted account is ended");
    check(!(await login(E, "SessionTest/6", NEW_PASSWORD)), "a deleted account cannot log in");
    check((await get(null, `/users/${E.username}`)).status === 404, "a deleted profile disappears");
    check((await get(null, `/blogs?author=${E.username}`)).data.data.length === 0, "a deleted user's posts disappear");
    check((await Follow.countDocuments({ $or: [{ follower: E._id }, { following: E._id }] })) === 0, "all follows of the deleted account are removed");
    check(
      (await User.findById(A._id)).followersCount === aBefore - 1 && (await User.findById(B._id)).followingCount === bBefore - 1,
      "other people's counters are corrected"
    );
    check((await ActivityLog.countDocuments({ user: E._id, event: "account_deleted" })) === 1, "the deletion is recorded in the activity log");

    console.log(`\nAll ${passed} checks passed 🎉`);
  } finally {
    const userIds = users.map((u) => u._id);
    const withImages = await User.find({ _id: { $in: userIds } }).select("avatar coverPicture").lean();
    for (const u of withImages) {
      await deleteImage(u.avatar?.publicId);
      await deleteImage(u.coverPicture?.publicId);
    }
    await Promise.all([
      Blog.deleteMany({ _id: { $in: blogIds } }),
      Follow.deleteMany({ $or: [{ follower: { $in: userIds } }, { following: { $in: userIds } }] }),
      ReadingHistory.deleteMany({ user: { $in: userIds } }),
      Notification.deleteMany({ recipient: { $in: userIds } }),
      UserPreference.deleteMany({ user: { $in: userIds } }),
      Session.deleteMany({ user: { $in: userIds } }),
      LoginHistory.deleteMany({ $or: [{ user: { $in: userIds } }, { identifier: { $regex: `_${tag}$` } }] }),
      ActivityLog.deleteMany({ user: { $in: userIds } }),
      User.deleteMany({ _id: { $in: userIds } }),
      category && Category.deleteOne({ _id: category._id }),
    ]);
    await disconnectDB();
  }
};

run().catch((err) => {
  console.error(err.message);
  process.exit(1);
});