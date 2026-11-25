import { connectDB, disconnectDB } from "../config/db.js";
import { env } from "../config/env.js";
import {
  User, UserPreference, Category, Blog, Like, Comment, Follow, Bookmark, Notification,
  BlogDailyView, BlogView, Session, LoginHistory, ActivityLog,
} from "../models/index.js";
import { startOfUtcDay, addDays, dayKey } from "../utils/dates.js";

const API = `http://localhost:${env.port}/api`;
const tag = Date.now().toString(36);
const PASSWORD = "Str0ng!Pass1";
let passed = 0;

const check = (condition, label) => {
  if (!condition) throw new Error(`FAILED: ${label}`);
  passed++;
  console.log(`✅ ${label}`);
};

const get = async (cookie, path, headers = {}) => {
  const res = await fetch(`${API}${path}`, { headers: { ...headers, ...(cookie && { cookie }) } });
  return { status: res.status, data: await res.json().catch(() => null) };
};

const mkUser = async (name) => {
  const user = await User.create({
    firstName: "Chk", lastName: name, username: `${name}_${tag}`, email: `${name}_${tag}@example.com`,
    password: PASSWORD, dateOfBirth: new Date("1995-01-01"), gender: "other",
  });
  await UserPreference.create({ user: user._id, consent: { termsAcceptedAt: new Date(), privacyAcceptedAt: new Date() } });
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
  const blogIds = [];
  let category;

  try {
    const A = await mkUser("author");
    const B = await mkUser("reader");
    const C = await mkUser("visitor");
    users.push(A, B, C);
    const [ca, cb] = await Promise.all([login(A), login(B)]);
    check(Boolean(ca && cb), "test users can log in");

    category = await Category.create({ name: `Dash ${tag}`, slug: `dash-${tag}` });
    const today = startOfUtcDay();
    const day = (daysAgo) => addDays(today, -daysAgo); // UTC midnight, for daily view rows
    const at = (daysAgo) => new Date(day(daysAgo).getTime() + 12 * 3600000); // noon of that day, for timestamps

    let n = 0;
    const mkBlog = async (extra = {}) => {
      const blog = await Blog.create({
        author: A._id, title: `Dash post ${++n} ${tag}`, slug: `dash-post-${n}-${tag}`, description: "check",
        content: "<p>Body text.</p>", categories: [category._id], tags: [`tg${tag}`],
        status: "published", publishedAt: new Date(Date.now() - 86400000), readingTime: 1, ...extra,
      });
      blogIds.push(blog._id);
      return blog;
    };
    const blog1 = await mkBlog({ views: 10, likesCount: 2, commentsCount: 2 });
    const blog2 = await mkBlog({ views: 5, likesCount: 1 });
    const draft = await mkBlog({ status: "draft", publishedAt: undefined });
    const scheduled = await mkBlog({ status: "scheduled", publishedAt: undefined, scheduledFor: new Date(Date.now() + 86400000) });
    await mkBlog({ status: "unpublished", views: 7, likesCount: 1 });
    const gone = await mkBlog({ views: 100, likesCount: 50, commentsCount: 9, deletedAt: new Date() });

    // daily views: blog1 {today: 5, 1 day ago: 3, 3 days ago: 2}, blog2 {today: 1, 10 days ago: 4}
    for (const [blog, daysAgo, views] of [[blog1, 0, 5], [blog1, 1, 3], [blog1, 3, 2], [blog2, 0, 1], [blog2, 10, 4]]) {
      await BlogDailyView.create({ blog: blog._id, author: A._id, day: day(daysAgo), views });
    }
    await BlogDailyView.create({ blog: gone._id, author: A._id, day: day(0), views: 500 });

    // likes: B on blog1 (1 day ago), C on blog1 (today), B on blog2 (2 days ago)
    await Like.create({ user: B._id, blog: blog1._id, createdAt: at(1) });
    await Like.create({ user: C._id, blog: blog1._id, createdAt: at(0) });
    await Like.create({ user: B._id, blog: blog2._id, createdAt: at(2) });

    // comments: two real ones on blog1, the author's own (not counted), a deleted one (not counted), one old one on blog2
    const mkComment = (blog, author, daysAgo, extra = {}) =>
      Comment.create({ blog: blog._id, author: author._id, content: "c", createdAt: at(daysAgo), ...extra });
    await mkComment(blog1, B, 1);
    await mkComment(blog1, C, 4);
    await mkComment(blog1, A, 0);
    await mkComment(blog1, B, 0, { deletedAt: new Date() });
    await mkComment(blog2, C, 12);

    // followers: B (2 days ago), C (8 days ago); bookmarks on blog1 by B and C
    await Follow.create({ follower: B._id, following: A._id, createdAt: at(2) });
    await Follow.create({ follower: C._id, following: A._id, createdAt: at(8) });
    await User.updateOne({ _id: A._id }, { followersCount: 2 });
    await Bookmark.create({ user: B._id, blog: blog1._id });
    await Bookmark.create({ user: C._id, blog: blog1._id });

    // notifications for A: 3 engagement ones (1 already read) + 1 security alert
    await Notification.create({ recipient: A._id, sender: B._id, type: "new_follower", message: "B followed you", isRead: true, createdAt: at(2) });
    await Notification.create({ recipient: A._id, sender: B._id, type: "new_comment", message: "B commented", createdAt: at(1) });
    await Notification.create({ recipient: A._id, sender: C._id, type: "blog_like", message: "C liked", createdAt: at(0) });
    await Notification.create({ recipient: A._id, type: "security_alert", message: "New sign-in" });

    // ---------- overview ----------
    check((await get(null, "/dashboard/overview")).status === 401, "the dashboard requires login");
    let r = await get(ca, "/dashboard/overview");
    check(r.status === 200, "the overview loads");
    let o = r.data.data;
    check(
      o.totals.published === 2 && o.totals.drafts === 1 && o.totals.scheduled === 1 && o.totals.unpublished === 1 && o.totals.removed === 0,
      "post counts per status are right (deleted posts are ignored)"
    );
    check(o.totals.views === 22 && o.totals.likes === 4 && o.totals.comments === 2, "lifetime views, likes and comments add up over your posts");
    check(o.totals.followers === 2 && o.totals.following === 0, "follower and following counts are included");
    check(
      o.last7Days.views === 11 && o.last7Days.likes === 3 && o.last7Days.comments === 2 && o.last7Days.newFollowers === 1,
      "the last-7-days trend is right (own comments, deleted comments and deleted posts are excluded)"
    );
    check(o.topArticles.map((x) => x._id).join() === [blog1._id, blog2._id].map(String).join(), "top articles are ordered by lifetime views");
    check(o.drafts.length === 1 && o.drafts[0]._id === String(draft._id), "recent drafts are listed");
    check(o.scheduled.length === 1 && o.scheduled[0]._id === String(scheduled._id) && o.scheduled[0].scheduledFor, "upcoming scheduled posts are listed");
    check(
      o.recentActivity.length === 3 && o.recentActivity[0].type === "blog_like" && o.recentActivity[0].sender.username === C.username,
      "recent activity shows the newest engagement first"
    );
    check(!o.recentActivity.some((x) => x.type === "security_alert"), "security alerts stay out of the activity feed");
    check(!JSON.stringify(o.recentActivity).includes("@example.com"), "activity senders show only public fields");
    check(o.unreadNotifications === 3, "the unread notification count is included");

    r = await get(cb, "/dashboard/overview");
    o = r.data.data;
    check(
      o.totals.published === 0 && o.totals.views === 0 && o.totals.likes === 0 && o.last7Days.views === 0 && o.recentActivity.length === 0,
      "another user's dashboard contains none of this data"
    );

    // ---------- analytics (7 days) ----------
    r = await get(ca, "/dashboard/analytics?range=7d");
    check(r.status === 200, "analytics load");
    let a = r.data.data;
    check(a.range.days === 7 && a.range.to === dayKey(today) && a.range.from === dayKey(day(6)), "the 7-day range ends today");
    check(a.series.length === 7 && a.series[6].date === dayKey(today) && a.series[0].date === dayKey(day(6)), "the series has one point per day in order");
    check(
      a.totals.views === 11 && a.totals.likes === 3 && a.totals.comments === 2 && a.totals.newFollowers === 1,
      "totals are right"
    );
    check(
      a.previousTotals.views === 4 && a.previousTotals.likes === 0 && a.previousTotals.comments === 1 && a.previousTotals.newFollowers === 1,
      "the previous period is calculated"
    );
    check(
      a.change.views === 175 && a.change.likes === null && a.change.comments === 100 && a.change.newFollowers === 0,
      "percent changes are right (null when there is nothing to compare with)"
    );
    const point = (daysAgo) => a.series[6 - daysAgo];
    check(point(0).views === 5 && point(0).likes === 1 && point(0).comments === 0, "today's point is right (own and deleted comments excluded)");
    check(point(1).views === 3 && point(1).likes === 1 && point(1).comments === 1, "yesterday's point is right");
    check(point(2).views === 0 && point(2).likes === 1 && point(2).newFollowers === 1, "days without views still show likes and followers");
    check(point(5).views === 0 && point(5).likes === 0 && point(5).comments === 0 && point(5).newFollowers === 0, "empty days are filled with zeros");
    check(
      a.topArticles.length === 2 && a.topArticles[0]._id === String(blog1._id) &&
        a.topArticles[0].views === 10 && a.topArticles[0].likes === 2 && a.topArticles[0].comments === 2 &&
        a.topArticles[1].views === 1 && a.topArticles[1].likes === 1 && a.topArticles[1].comments === 0,
      "top articles show their numbers for the range"
    );
    check(!a.topArticles.some((x) => x._id === String(gone._id)), "deleted posts never appear in top articles");
    check(
      a.categories.length === 1 && a.categories[0].slug === `dash-${tag}` && a.categories[0].articles === 2 &&
        a.categories[0].views === 15 && a.categories[0].likes === 3,
      "the category breakdown counts published posts"
    );

    // ---------- analytics (other ranges) ----------
    r = await get(ca, "/dashboard/analytics");
    check(r.data.data.range.days === 30 && r.data.data.series.length === 30 && r.data.data.totals.views === 15, "the default range is 30 days");
    r = await get(ca, "/dashboard/analytics?range=90d");
    a = r.data.data;
    check(a.series.length === 90 && a.totals.views === 15 && a.totals.comments === 3 && a.totals.likes === 3 && a.totals.newFollowers === 2, "the 90-day range works");
    r = await get(ca, `/dashboard/analytics?from=${dayKey(day(10))}&to=${dayKey(day(10))}`);
    check(r.data.data.range.days === 1 && r.data.data.series.length === 1 && r.data.data.totals.views === 4, "a custom single-day range works");
    r = await get(ca, `/dashboard/analytics?range=7d&to=${dayKey(addDays(today, 5))}`);
    check(r.data.data.range.to === dayKey(today), "future days are clamped to today");
    check((await get(ca, "/dashboard/analytics?range=bogus")).status === 422, "an unknown range is rejected");
    check((await get(ca, `/dashboard/analytics?from=${dayKey(day(1))}&to=${dayKey(day(3))}`)).status === 422, "a start date after the end date is rejected");
    check((await get(ca, `/dashboard/analytics?from=${dayKey(day(400))}`)).status === 422, "a range longer than a year is rejected");
    check((await get(ca, "/dashboard/analytics?from=2026/01/01")).status === 422, "a badly formatted date is rejected");
    check((await get(cb, "/dashboard/analytics?range=7d")).data.data.totals.views === 0, "analytics only count your own posts");

    // ---------- article analytics ----------
    r = await get(ca, `/dashboard/articles/${blog1._id}/analytics`);
    const art = r.data.data;
    check(r.status === 200 && art.article.title === blog1.title && art.article.status === "published", "article analytics load");
    check(art.lifetime.views === 10 && art.lifetime.likes === 2 && art.lifetime.comments === 2 && art.lifetime.bookmarks === 2, "lifetime numbers include the bookmark count");
    check(art.totals.views === 10 && art.totals.likes === 2 && art.totals.comments === 2 && art.series.length === 30, "range totals and series are right");
    check(!("newFollowers" in art.series[0]), "article series hold only article metrics");
    r = await get(ca, `/dashboard/articles/${blog2._id}/analytics`);
    check(r.data.data.totals.views === 5 && r.data.data.totals.likes === 1 && r.data.data.totals.comments === 1, "another article has its own numbers");
    r = await get(ca, `/dashboard/articles/${draft._id}/analytics`);
    check(r.status === 200 && r.data.data.article.status === "draft" && r.data.data.totals.views === 0, "a draft has analytics too (all zeros)");
    check((await get(cb, `/dashboard/articles/${blog1._id}/analytics`)).status === 404, "another user's article analytics give 404");
    check((await get(ca, `/dashboard/articles/${gone._id}/analytics`)).status === 404, "a deleted article's analytics give 404");
    check((await get(ca, "/dashboard/articles/not-an-id/analytics")).status === 422, "an invalid article id is rejected");

    // ---------- real page view feeds the daily counter ----------
    const before = await BlogDailyView.findOne({ blog: blog1._id, day: today });
    await get(null, `/blogs/${blog1.slug}`, { "user-agent": `DashboardCheck/${tag}` });
    const after = await BlogDailyView.findOne({ blog: blog1._id, day: today });
    check(after.views === before.views + 1, "a real page view increments today's daily counter");
    check(String(after.author) === String(A._id), "the daily row stores the author");

    console.log(`\nAll ${passed} checks passed 🎉`);
  } finally {
    const userIds = users.map((u) => u._id);
    await Promise.all([
      BlogDailyView.deleteMany({ blog: { $in: blogIds } }),
      BlogView.deleteMany({ blog: { $in: blogIds } }),
      Like.deleteMany({ blog: { $in: blogIds } }),
      Comment.deleteMany({ blog: { $in: blogIds } }),
      Bookmark.deleteMany({ blog: { $in: blogIds } }),
      Blog.deleteMany({ _id: { $in: blogIds } }),
      Follow.deleteMany({ $or: [{ follower: { $in: userIds } }, { following: { $in: userIds } }] }),
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