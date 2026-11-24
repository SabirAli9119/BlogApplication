import { connectDB, disconnectDB } from "../config/db.js";
import { env } from "../config/env.js";
import { User, UserPreference, Category, Blog, Session, LoginHistory, ActivityLog } from "../models/index.js";

const API = `http://localhost:${env.port}/api`;
const tag = Date.now().toString(36);
const T = `tg${tag}`; // every test blog carries this tag, so we can isolate them from real data
const PASSWORD = "Str0ng!Pass1";
let passed = 0;

const check = (condition, label) => {
  if (!condition) throw new Error(`FAILED: ${label}`);
  passed++;
  console.log(`✅ ${label}`);
};

const get = async (path, cookie) => {
  const res = await fetch(`${API}${path}`, { headers: cookie ? { cookie } : {} });
  return { status: res.status, body: await res.json() };
};
const ids = (r) => r.body.data.map((b) => String(b._id));
const sameSet = (a, b) => a.length === b.length && b.every((x) => a.includes(x));
const hoursAgo = (h) => new Date(Date.now() - h * 3600000);

const mkUser = async (name, { status, isPrivate } = {}) => {
  const user = await User.create({
    firstName: "Chk", lastName: name, username: `${name}_${tag}`, email: `${name}_${tag}@example.com`,
    password: PASSWORD, dateOfBirth: new Date("1995-01-01"), gender: "other", ...(status && { status }),
  });
  await UserPreference.create({
    user: user._id,
    privacy: { profileVisibility: isPrivate ? "private" : "public" },
    consent: { termsAcceptedAt: new Date(), privacyAcceptedAt: new Date() },
  });
  return user;
};

const run = async () => {
  await connectDB();
  const users = [];
  let category;

  try {
    const pub = await mkUser("pub");
    const priv = await mkUser("priv", { isPrivate: true });
    const susp = await mkUser("susp", { status: "suspended" });
    users.push(pub, priv, susp);
    category = await Category.create({ name: `Chk ${tag}`, slug: `chk-${tag}` });

    let n = 0;
    const mk = (author, o = {}) =>
      Blog.create({
        author: author._id, title: `Post ${++n} ${tag}`, slug: `post-${n}-${tag}`, description: "check",
        content: "<p>SECRET-BODY</p>", tags: [T], categories: [category._id],
        status: "published", publishedAt: hoursAgo(3), ...o,
      });

    const A = await mk(pub, { title: `Zephyr${tag} handbook`, views: 50, likesCount: 5, publishedAt: hoursAgo(1) });
    const B = await mk(pub, { views: 500, publishedAt: hoursAgo(2) });
    const C = await mk(pub, { isFeatured: true, featuredAt: new Date() });
    const D = await mk(pub, { status: "draft", publishedAt: undefined });
    const E = await mk(pub, { status: "scheduled", scheduledFor: new Date(Date.now() + 3600000), publishedAt: undefined });
    const F = await mk(pub, { status: "removed" });
    const G = await mk(pub, { publishedAt: new Date(Date.now() + 3600000) });
    const H = await mk(priv);
    const I = await mk(susp);
    const [a, b, c] = [A, B, C].map((x) => String(x._id));
    const hiddenIds = [D, E, F, G, H, I].map((x) => String(x._id));

    // ----- visibility -----
    let r = await get(`/blogs?tag=${T}`);
    check(r.status === 200, "GET /blogs works without logging in");
    check(sameSet(ids(r), [a, b, c]), "only published, public posts are listed");
    check(hiddenIds.every((id) => !ids(r).includes(id)), "drafts, scheduled, removed, future, private-author and suspended-author posts are hidden");
    check(r.body.data.every((x) => !("content" in x)), "listing never includes the full content");
    check(
      r.body.data.every((x) => x.author.username && !("email" in x.author) && !("password" in x.author)),
      "author shows only public fields"
    );

    // ----- pagination and sorting -----
    r = await get(`/blogs?tag=${T}&limit=2&page=1`);
    check(r.body.data.length === 2 && r.body.meta.total === 3 && r.body.meta.totalPages === 2 && r.body.meta.hasNext, "pagination meta is correct");
    r = await get(`/blogs?tag=${T}&limit=2&page=2`);
    check(r.body.data.length === 1 && !r.body.meta.hasNext, "page 2 holds the last post");
    r = await get(`/blogs?tag=${T}&sort=popular`);
    check(ids(r)[0] === b, "sort=popular puts the most viewed post first");
    r = await get(`/blogs?tag=${T}`);
    check(ids(r)[0] === a, "default sort is newest first");

    // ----- filters and search -----
    r = await get(`/blogs?category=chk-${tag}&tag=${T}`);
    check(sameSet(ids(r), [a, b, c]), "category filter works");
    r = await get(`/blogs?category=does-not-exist`);
    check(r.status === 200 && r.body.data.length === 0, "unknown category gives an empty list, not an error");
    r = await get(`/blogs?author=pub_${tag}&tag=${T}`);
    check(sameSet(ids(r), [a, b, c]), "author filter works");
    r = await get(`/blogs?author=priv_${tag}`);
    check(r.body.data.length === 0, "a private author's posts cannot be fetched by username");
    r = await get(`/blogs?q=Zephyr${tag}`);
    check(ids(r).includes(a) && r.body.data.length === 1, "text search finds the matching post");
    check(!("score" in r.body.data[0]), "internal search score is not exposed");

    // ----- trending, featured, categories, suggestions -----
    r = await get(`/blogs/trending?limit=20`);
    const trend = ids(r);
    check(trend.includes(a) && trend.includes(b) && trend.indexOf(b) < trend.indexOf(a), "trending ranks the higher-scoring post first");
    check(hiddenIds.every((id) => !trend.includes(id)), "trending also hides non-public posts");
    r = await get(`/blogs/featured`);
    check(ids(r).includes(c) && hiddenIds.every((id) => !ids(r).includes(id)), "featured shows featured public posts only");
    r = await get(`/categories`);
    check(r.body.data.some((x) => x.slug === `chk-${tag}`), "categories endpoint lists active categories");
    r = await get(`/categories/popular`);
    check(r.body.data.find((x) => x.slug === `chk-${tag}`)?.count === 3, "popular categories count only public posts");
    r = await get(`/blogs/search-suggestions?q=Zephyr${tag}`);
    check(r.body.data.blogs.some((x) => x.slug === `post-1-${tag}`), "suggestions include matching titles");
    r = await get(`/blogs/search-suggestions?q=${T}`);
    check(r.body.data.tags.includes(T), "suggestions include matching tags");

    // ----- validation -----
    check((await get(`/blogs?limit=500`)).status === 422, "limit above 50 is rejected");
    check((await get(`/blogs?sort=hacked`)).status === 422, "unknown sort value is rejected");
    check((await get(`/blogs/search-suggestions?q=a`)).status === 422, "one-letter suggestion query is rejected");

    // ----- homepage and personalization -----
    r = await get(`/home`);
    check(
      r.status === 200 && ["featured", "latest", "trending", "popularCategories", "recommended"].every((k) => k in r.body.data),
      "/home returns every homepage section"
    );
    r = await get(`/blogs/recommended`);
    check(r.body.meta.reason === "popular", "guests get popular posts as recommendations");

    const login = await fetch(`${API}/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ identifier: `priv_${tag}`, password: PASSWORD }),
    });
    const cookie = login.headers.getSetCookie().find((x) => x.startsWith("accessToken="))?.split(";")[0];
    check(login.status === 200 && Boolean(cookie), "test author can log in");
    r = await get(`/blogs?tag=${T}`, cookie);
    check(r.body.data.length === 4 && ids(r).includes(String(H._id)), "a private author still sees their own posts");
    r = await get(`/blogs?tag=${T}`, "accessToken=garbage");
    check(r.status === 200 && r.body.data.length === 3, "an invalid token is treated as a guest, not an error");

    console.log(`\nAll ${passed} checks passed 🎉`);
  } finally {
    const userIds = users.map((u) => u._id);
    await Promise.all([
      Blog.deleteMany({ author: { $in: userIds } }),
      UserPreference.deleteMany({ user: { $in: userIds } }),
      Session.deleteMany({ user: { $in: userIds } }),
      LoginHistory.deleteMany({ $or: [{ user: { $in: userIds } }, { identifier: `priv_${tag}` }] }),
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