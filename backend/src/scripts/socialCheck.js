import { connectDB, disconnectDB } from "../config/db.js";
import { env } from "../config/env.js";
import {
  User, UserPreference, Category, Blog, Comment, Like, Bookmark, ReadingHistory,
  BlogView, Notification, Session, LoginHistory, ActivityLog,
} from "../models/index.js";

const API = `http://localhost:${env.port}/api`;
const tag = Date.now().toString(36);
const PASSWORD = "Str0ng!Pass1";
const GHOST_ID = "507f1f77bcf86cd799439011";
let passed = 0;

const check = (condition, label) => {
  if (!condition) throw new Error(`FAILED: ${label}`);
  passed++;
  console.log(`✅ ${label}`);
};

const request = async (cookie, method, path, { json, headers = {} } = {}) => {
  const h = { ...headers };
  if (cookie) h.cookie = cookie;
  let body;
  if (json !== undefined) { h["content-type"] = "application/json"; body = JSON.stringify(json); }
  const res = await fetch(`${API}${path}`, { method, headers: h, body });
  return { status: res.status, data: await res.json().catch(() => null) };
};
const get = (cookie, path, ua) => request(cookie, "GET", path, { headers: ua ? { "user-agent": ua } : {} });
const post = (cookie, path, json = {}) => request(cookie, "POST", path, { json });

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

const login = async (user) => {
  const res = await fetch(`${API}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ identifier: user.username, password: PASSWORD }),
  });
  return res.headers.getSetCookie().find((c) => c.startsWith("accessToken="))?.split(";")[0];
};

const run = async () => {
  await connectDB();
  const users = [];
  let category;
  const blogIds = [];

  try {
    const A = await mkUser("author");
    const B = await mkUser("reader");
    const C = await mkUser("second");
    const P = await mkUser("private", { isPrivate: true });
    const S = await mkUser("spammer");
    const Z = await mkUser("suspended", { status: "suspended" });
    users.push(A, B, C, P, S, Z);
    const [ca, cb, cc, cp, cs] = await Promise.all([A, B, C, P, S].map(login));
    check([ca, cb, cc, cp, cs].every(Boolean), "test users can log in");

    category = await Category.create({ name: `Social ${tag}`, slug: `social-${tag}` });
    let n = 0;
    const mkBlog = async (author, extra = {}) => {
      const blog = await Blog.create({
        author: author._id, title: `Social post ${++n} ${tag}`, slug: `social-${n}-${tag}`, description: "check",
        content: "<p>Hello <strong>world</strong>, this is the body text of the post.</p>",
        categories: [category._id], tags: [`tg${tag}`], status: "published",
        publishedAt: new Date(Date.now() - 3600000), readingTime: 1, ...extra,
      });
      blogIds.push(blog._id);
      return blog;
    };
    const main = await mkBlog(A);
    const rel1 = await mkBlog(A);
    const rel2 = await mkBlog(A);
    const draft = await mkBlog(A, { status: "draft", publishedAt: undefined });
    const privBlog = await mkBlog(P);
    const suspBlog = await mkBlog(Z);
    const mainPath = `/blogs/${main.slug}`;
    const count = async (model, filter) => model.countDocuments(filter);

    // ---------- detail page ----------
    let r = await get(null, mainPath, "TestBrowser/1");
    check(r.status === 200 && r.data.data.blog.title === main.title, "a published post can be read without logging in");
    let b = r.data.data.blog;
    check(b.content.includes("<strong>world</strong>"), "the full content is included");
    check(
      b.author.username === A.username && !["email", "dateOfBirth", "password", "status", "role"].some((k) => k in b.author),
      "the author card shows only public fields"
    );
    check(!("status" in b) && b.viewer.liked === false && b.viewer.bookmarked === false && !b.viewer.isAuthor, "guests get no status and empty viewer flags");
    check(b.url.endsWith(`/blog/${main.slug}`) && b.seo.title === main.title, "share url and seo fallbacks are included");
    check(b.views === 1, "the first visit counts as a view");
    r = await get(null, mainPath, "TestBrowser/1");
    check(r.data.data.blog.views === 1, "refreshing does not add a view");
    r = await get(null, mainPath, "TestBrowser/2");
    check(r.data.data.blog.views === 2, "a different visitor adds a view");
    r = await get(null, mainPath, "Googlebot/2.1");
    check(r.data.data.blog.views === 2, "bots are not counted");
    r = await get(ca, mainPath, "TestBrowser/9");
    check(r.data.data.blog.views === 2 && r.data.data.blog.status === "published" && r.data.data.blog.viewer.isAuthor, "the author's own visit is not counted and sees the status");
    check((await count(ReadingHistory, { blog: main._id })) === 0, "guests and authors leave no reading history");
    r = await get(cb, mainPath, "TestBrowser/3");
    check(r.data.data.blog.views === 3, "a logged-in reader counts once");
    r = await get(cb, mainPath, "TestBrowser/4");
    check(r.data.data.blog.views === 3, "the same account on another browser is still one view");
    check(Boolean(await ReadingHistory.exists({ user: B._id, blog: main._id })), "a logged-in read is added to the reading history");
    check((await count(BlogView, { blog: main._id })) === 3, "view records hold no raw ids or addresses");

    r = await get(null, `/blogs/${draft.slug}`);
    check(r.status === 404, "a draft is hidden from guests");
    r = await get(ca, `/blogs/${draft.slug}`);
    check(r.status === 200 && r.data.data.blog.status === "draft", "the author can open their own draft");
    check((await Blog.findById(draft._id)).views === 0, "views of a draft are not counted");
    check((await get(null, `/blogs/${privBlog.slug}`)).status === 404, "a private author's post is hidden from guests");
    check((await get(cb, `/blogs/${privBlog.slug}`)).status === 404, "a private author's post is hidden from other users");
    check((await get(cp, `/blogs/${privBlog.slug}`)).status === 200, "a private author can read their own post");
    check((await get(null, `/blogs/${suspBlog.slug}`)).status === 404, "posts of a suspended author are hidden");
    check((await get(null, "/blogs/no-such-post-xyz")).status === 404, "an unknown post gives 404");
    check((await get(null, "/blogs/bad_slug")).status === 422, "an invalid slug is rejected");
    check((await get(null, "/blogs/mine")).status === 401, "/blogs/mine is not mistaken for a slug");

    // ---------- related posts ----------
    r = await get(null, `/blogs/${main._id}/related?limit=12`);
    const relIds = r.data.data.map((x) => x._id);
    check(r.status === 200 && relIds.includes(String(rel1._id)) && relIds.includes(String(rel2._id)), "related posts include posts from the same category");
    check(![main, draft, privBlog, suspBlog].some((x) => relIds.includes(String(x._id))), "related posts exclude the post itself and every hidden post");
    check(r.data.data.every((x) => !("content" in x)), "related posts are cards without content");
    check((await get(null, `/blogs/${main._id}/related?limit=1`)).data.data.length === 1, "the related limit is respected");
    check((await get(null, `/blogs/${draft._id}/related`)).status === 404, "related posts of a hidden post are not available");
    check((await get(null, `/blogs/nope/related`)).status === 422, "related with an invalid id is rejected");

    // ---------- likes ----------
    check((await post(null, `/blogs/${main._id}/like`)).status === 401, "liking requires login");
    r = await post(cb, `/blogs/${main._id}/like`);
    check(r.status === 200 && r.data.data.liked === true && r.data.data.likesCount === 1, "a post can be liked");
    r = await post(cb, `/blogs/${main._id}/like`);
    check(r.data.data.likesCount === 1 && (await count(Like, { blog: main._id })) === 1, "liking twice does not double count");
    const likeNotes = () => count(Notification, { recipient: A._id, type: "blog_like", sender: B._id });
    check((await likeNotes()) === 1, "the author is notified of the like");
    r = await request(cb, "DELETE", `/blogs/${main._id}/like`);
    check(r.data.data.liked === false && r.data.data.likesCount === 0, "a like can be removed");
    r = await request(cb, "DELETE", `/blogs/${main._id}/like`);
    check(r.status === 200 && r.data.data.liked === false && !("likesCount" in r.data.data), "unliking twice is harmless and reveals nothing");
    await post(cb, `/blogs/${main._id}/like`);
    check((await likeNotes()) === 1, "like, unlike, like again sends only one notification");
    check((await post(ca, `/blogs/${main._id}/like`)).status === 400, "you cannot like your own post");
    check((await post(cb, `/blogs/${draft._id}/like`)).status === 404, "a draft cannot be liked by others");
    check((await post(ca, `/blogs/${draft._id}/like`)).status === 404, "a draft cannot be liked by its author either");
    check((await post(cb, `/blogs/${privBlog._id}/like`)).status === 404, "a private author's post cannot be liked");

    await UserPreference.updateOne({ user: A._id }, { "notifications.likes": false });
    await post(cc, `/blogs/${main._id}/like`);
    check((await count(Notification, { recipient: A._id, type: "blog_like", sender: C._id })) === 0, "like notifications respect the author's settings");
    await UserPreference.updateOne({ user: A._id }, { "notifications.likes": true });

    await Promise.all(Array.from({ length: 5 }, () => post(cc, `/blogs/${rel1._id}/like`)));
    check(
      (await Blog.findById(rel1._id)).likesCount === 1 && (await count(Like, { blog: rel1._id })) === 1,
      "five simultaneous likes count exactly once"
    );

    // ---------- bookmarks ----------
    check((await post(null, `/bookmarks/${main._id}`)).status === 401, "bookmarking requires login");
    check((await post(cb, `/bookmarks/${main._id}`)).data.data.bookmarked === true, "a post can be bookmarked");
    await post(cb, `/bookmarks/${main._id}`);
    check((await count(Bookmark, { user: B._id, blog: main._id })) === 1, "bookmarking twice keeps one bookmark");
    await post(cb, `/bookmarks/${rel1._id}`);
    await post(cb, `/bookmarks/${rel2._id}`);
    check((await post(cb, `/bookmarks/${draft._id}`)).status === 404, "a draft cannot be bookmarked");
    check((await post(cb, `/bookmarks/${privBlog._id}`)).status === 404, "a private author's post cannot be bookmarked");

    r = await get(cb, "/bookmarks?limit=2&page=1");
    check(r.status === 200 && r.data.data.length === 2 && r.data.meta.total === 3 && r.data.meta.hasNext, "bookmarks are listed with pagination");
    check(r.data.data[0]._id === String(rel2._id) && r.data.data[0].bookmarkedAt, "the newest bookmark comes first");
    check(r.data.data.every((x) => !("content" in x) && x.author.username), "bookmarks are cards with author info");
    check((await get(cb, "/bookmarks?limit=2&page=2")).data.data.length === 1, "page 2 holds the last bookmark");
    check((await get(cc, "/bookmarks")).data.meta.total === 0, "users only see their own bookmarks");

    r = await get(cb, mainPath, "TestBrowser/5");
    check(r.data.data.blog.viewer.liked === true && r.data.data.blog.viewer.bookmarked === true, "the detail page shows liked and bookmarked for the viewer");

    await Blog.updateOne({ _id: main._id }, { status: "unpublished" });
    check((await get(cb, "/bookmarks")).data.meta.total === 2, "an unpublished post disappears from bookmarks");
    check((await request(cb, "DELETE", `/bookmarks/${main._id}`)).status === 200, "a hidden post's bookmark can still be removed");
    await Blog.updateOne({ _id: main._id }, { status: "published" });
    check((await request(cb, "DELETE", `/bookmarks/${rel1._id}`)).data.data.bookmarked === false, "a bookmark can be removed");

    // ---------- comments ----------
    const commentsPath = `/blogs/${main._id}/comments`;
    check((await post(null, commentsPath, { content: "hi" })).status === 401, "commenting requires login");
    r = await post(cb, commentsPath, { content: "<script>alert(1)</script>Nice <b>post</b>!\n\n\n\nSecond line" });
    check(r.status === 201, "a comment can be posted");
    const c1 = r.data.data.comment;
    check(c1.content === "Nice post!\n\nSecond line", "HTML is stripped from comments and line breaks are kept");
    check(c1.author.username === B.username && !("email" in c1.author) && c1.canDelete === true, "the comment shows a safe author card");
    check(r.data.data.commentsCount === 1, "the comment counter is updated");
    check((await count(Notification, { recipient: A._id, type: "new_comment", sender: B._id })) === 1, "the author is notified of the comment");
    check((await post(cb, commentsPath, { content: "<script>x</script>" })).status === 422, "a comment that is empty after cleaning is rejected");
    check((await post(cb, commentsPath, { content: "a".repeat(2001) })).status === 422, "a comment over 2000 characters is rejected");

    r = await post(cc, commentsPath, { content: "Great point", parentId: c1._id });
    check(r.status === 201 && String(r.data.data.comment.parent) === String(c1._id), "a comment can be replied to");
    const reply1 = r.data.data.comment;
    check((await count(Notification, { recipient: B._id, type: "comment_reply", sender: C._id })) === 1, "the person replied to is notified");
    check((await count(Notification, { recipient: A._id, type: "new_comment", sender: C._id })) === 1, "the post author is notified of the reply too");
    r = await post(ca, commentsPath, { content: "Thanks both", parentId: reply1._id });
    check(String(r.data.data.comment.parent) === String(c1._id), "replying to a reply attaches to the top-level comment");
    check((await count(Notification, { recipient: C._id, type: "comment_reply", sender: A._id })) === 1, "the replied-to person is notified");
    check((await count(Notification, { recipient: A._id, sender: A._id })) === 0, "nobody is notified about their own actions");
    check((await post(cb, commentsPath, { content: "x", parentId: GHOST_ID })).status === 404, "replying to a missing comment is rejected");
    const other = await post(cb, `/blogs/${rel2._id}/comments`, { content: "On another post" });
    check((await post(cb, commentsPath, { content: "x", parentId: other.data.data.comment._id })).status === 404, "a reply cannot point to a comment on another post");
    check((await Blog.findById(main._id)).commentsCount === 3, "the counter includes replies");

    r = await get(null, commentsPath);
    check(r.data.data.length === 1 && r.data.data[0].replyCount === 2 && r.data.data[0].canDelete === false, "the list shows top-level comments with reply counts");
    check(r.data.meta.commentsCount === 3, "the list reports the total comment count");
    check((await get(cb, commentsPath)).data.data[0].canDelete === true, "owners see canDelete on their comment");
    check((await get(null, `${commentsPath}?sort=oldest`)).status === 200, "comments can be sorted oldest first");
    r = await get(null, `/comments/${c1._id}/replies`);
    check(r.data.data.length === 2 && r.data.data[0]._id === reply1._id, "replies are listed oldest first");

    await User.updateOne({ _id: C._id }, { restrictions: ["comment"] });
    r = await post(cc, commentsPath, { content: "blocked" });
    check(r.status === 403 && r.data.code === "COMMENT_RESTRICTED", "a user restricted from commenting is blocked");
    await User.updateOne({ _id: C._id }, { restrictions: [] });

    check((await post(cb, `/blogs/${draft._id}/comments`, { content: "x" })).status === 404, "comments on a draft are rejected");
    check((await post(cb, `/blogs/${privBlog._id}/comments`, { content: "x" })).status === 404, "comments on a private author's post are rejected");
    check((await get(null, `/blogs/${privBlog._id}/comments`)).status === 404, "comments of a private author's post are hidden");

    // ---------- deleting comments ----------
    r = await post(cc, commentsPath, { content: "Delete me" });
    const c2 = r.data.data.comment;
    check((await request(null, "DELETE", `/comments/${c2._id}`)).status === 401, "deleting a comment requires login");
    check((await request(cb, "DELETE", `/comments/${c2._id}`)).status === 403, "other readers cannot delete someone's comment");
    check((await request(ca, "DELETE", `/comments/${c2._id}`)).status === 200, "the post author can delete any comment on their post");
    check((await Blog.findById(main._id)).commentsCount === 3, "the counter drops after a delete");
    check((await request(ca, "DELETE", `/comments/${c2._id}`)).status === 404, "deleting twice returns 404");
    check((await request(cc, "DELETE", `/comments/${c1._id}`)).status === 403, "a reply author cannot delete the top-level comment");
    check((await request(cb, "DELETE", `/comments/${c1._id}`)).status === 200, "a comment's author can delete it");
    check((await Blog.findById(main._id)).commentsCount === 0, "deleting a comment also removes its replies and fixes the counter");
    check((await get(null, commentsPath)).data.data.length === 0, "deleted comments disappear from the list");
    check((await get(null, `/comments/${c1._id}/replies`)).status === 404, "replies of a deleted comment are gone");

    r = await post(cs, commentsPath, { content: "Spam spam spam" });
    check(r.status === 201 && (await get(null, commentsPath)).data.data.length === 1, "a new comment appears in the list");
    await User.updateOne({ _id: S._id }, { status: "suspended" });
    check((await get(null, commentsPath)).data.data.length === 0, "comments of a suspended user disappear");

    console.log(`\nAll ${passed} checks passed 🎉`);
  } finally {
    const userIds = users.map((u) => u._id);
    await Promise.all([
      Comment.deleteMany({ blog: { $in: blogIds } }),
      Like.deleteMany({ blog: { $in: blogIds } }),
      Bookmark.deleteMany({ blog: { $in: blogIds } }),
      ReadingHistory.deleteMany({ blog: { $in: blogIds } }),
      BlogView.deleteMany({ blog: { $in: blogIds } }),
      Blog.deleteMany({ _id: { $in: blogIds } }),
      Notification.deleteMany({ recipient: { $in: userIds } }),
      UserPreference.deleteMany({ user: { $in: userIds } }),
      Session.deleteMany({ user: { $in: userIds } }),
      LoginHistory.deleteMany({ user: { $in: userIds } }),
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