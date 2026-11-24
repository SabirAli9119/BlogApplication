import { connectDB, disconnectDB } from "../config/db.js";
import { env } from "../config/env.js";
import { User, Category, Blog, Session, LoginHistory, ActivityLog } from "../models/index.js";
import { deleteImage } from "../services/upload.service.js";
import { publishDueBlogs } from "../jobs/publishScheduledBlogs.job.js";

const API = `http://localhost:${env.port}/api`;
const tag = Date.now().toString(36);
const T = `tg${tag}`;
const PASSWORD = "Str0ng!Pass1";
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64"
);
const LONG = `<p>${"word ".repeat(450)}</p>`;
let passed = 0;

const check = (condition, label) => {
  if (!condition) throw new Error(`FAILED: ${label}`);
  passed++;
  console.log(`✅ ${label}`);
};

const request = async (cookie, method, path, { json, form } = {}) => {
  const headers = {};
  if (cookie) headers.cookie = cookie;
  let body;
  if (json !== undefined) { headers["content-type"] = "application/json"; body = JSON.stringify(json); }
  if (form) body = form;
  const res = await fetch(`${API}${path}`, { method, headers, body });
  return { status: res.status, data: await res.json().catch(() => null) };
};

const imageForm = (field, { type = "image/png", bytes = PNG } = {}) => {
  const form = new FormData();
  form.append(field, new Blob([bytes], { type }), "file.png");
  return form;
};

const mkUser = (name) =>
  User.create({
    firstName: "Chk", lastName: name, username: `${name}_${tag}`, email: `${name}_${tag}@example.com`,
    password: PASSWORD, dateOfBirth: new Date("1995-01-01"), gender: "other",
  });

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
  const inlineImageIds = [];
  let category;

  try {
    const A = await mkUser("author");
    const B = await mkUser("other");
    users.push(A, B);
    category = await Category.create({ name: `Crud ${tag}`, slug: `crud-${tag}` });
    const ca = await login(A);
    const cb = await login(B);
    check(Boolean(ca && cb), "test users can log in");

    let n = 0;
    const publicIds = async () =>
      (await request(null, "GET", `/blogs?tag=${T}&limit=50`)).data.data.map((b) => b._id);
    const fillIn = (id, extra = {}) =>
      request(ca, "PUT", `/blogs/${id}`, {
        json: { title: `Ready post ${++n} ${tag}`, content: LONG, categories: [String(category._id)], tags: [T], ...extra },
      });
    const status = (id, body, cookie = ca) => request(cookie, "PATCH", `/blogs/${id}/status`, { json: body });
    const newDraft = async () => (await request(ca, "POST", "/blogs", { json: {} })).data.data.blog._id;

    // ---------- create ----------
    let r = await request(null, "POST", "/blogs", { json: {} });
    check(r.status === 401, "creating a post requires login");

    r = await request(ca, "POST", "/blogs", {
      json: { title: "  ", status: "published", author: String(B._id), views: 9999, likesCount: 50, isFeatured: true, slug: "hacked" },
    });
    check(r.status === 201, "a draft can be created");
    const created = r.data.data.blog;
    const id1 = created._id;
    check(created.status === "draft" && created.title === "Untitled draft", "new posts start as drafts with a placeholder title");
    check(created.views === 0 && created.likesCount === 0 && !created.isFeatured && created.slug !== "hacked", "client cannot set status, counters, featured or slug");
    check(String(created.author) === String(A._id), "client cannot choose the author");
    r = await request(null, "GET", `/blogs?author=${A.username}`);
    check(r.data.data.length === 0, "drafts are not public");

    // ---------- update and sanitizing ----------
    const dirty =
      `<p>Intro <strong>bold</strong></p><h2>Heading</h2><script>alert(1)</script>` +
      `<img src="https://evil.example/x.png" onerror="alert(1)">` +
      `<a href="javascript:alert(1)">bad link</a><a href="https://example.com">good link</a>` +
      `<p onclick="steal()">${"word ".repeat(450)}</p>`;
    r = await request(ca, "PUT", `/blogs/${id1}`, {
      json: {
        title: `Check Post ${tag}`, content: dirty, categories: [String(category._id)],
        tags: ["  React ", "react", "Node JS", T], seo: { title: "SEO title", description: "SEO description" },
      },
    });
    check(r.status === 200, "a post can be edited");
    const saved = r.data.data.blog;
    const html = saved.content;
    check(!/<script|alert\(1\)|onerror|onclick|evil\.example|javascript:/i.test(html), "scripts, event handlers, javascript: links and foreign images are removed");
    check(html.includes("<strong>bold</strong>") && html.includes("<h2>Heading</h2>"), "safe formatting is kept");
    check(html.includes('rel="noopener noreferrer nofollow ugc"') && html.includes('href="https://example.com"'), "links are safe (rel attributes added)");
    check(saved.readingTime === 3, "reading time is calculated (~457 words = 3 min)");
    check(JSON.stringify(saved.tags) === JSON.stringify(["react", "node-js", T]), "tags are normalized and de-duplicated");
    check(saved.slug.startsWith("check-post-") && saved.slug !== created.slug, "slug follows the title while the post is a draft");
    check(saved.categories[0].slug === `crud-${tag}`, "categories come back populated");

    r = await request(ca, "PUT", `/blogs/${id1}`, { json: { categories: ["507f1f77bcf86cd799439011"] } });
    check(r.status === 400, "an unknown category is rejected");
    r = await request(ca, "PUT", `/blogs/${id1}`, { json: { tags: Array.from({ length: 11 }, (_, i) => `t${i}`) } });
    check(r.status === 422, "more than 10 tags is rejected");
    r = await request(ca, "PUT", `/blogs/${id1}`, { json: { title: "a".repeat(151) } });
    check(r.status === 422, "a title over 150 characters is rejected");
    r = await request(ca, "PUT", "/blogs/not-an-id", { json: {} });
    check(r.status === 422, "an invalid id is rejected");

    // ---------- conflicts and autosave ----------
    r = await request(ca, "PUT", `/blogs/${id1}`, { json: { description: "x", expectedUpdatedAt: created.updatedAt } });
    check(r.status === 409 && r.data.code === "EDIT_CONFLICT", "saving from a stale copy is rejected (edit conflict)");
    r = await request(ca, "PUT", `/blogs/${id1}`, {
      json: { description: "A custom description", expectedUpdatedAt: saved.updatedAt, autosave: true },
    });
    check(r.status === 200 && r.data.data.blog.updatedAt !== saved.updatedAt, "saving with the latest version works");

    const edits = () => ActivityLog.countDocuments({ user: A._id, event: "blog_edit" });
    check((await ActivityLog.countDocuments({ user: A._id, event: "blog_create" })) >= 1, "creating a post is recorded in the activity log");
    const before = await edits();
    await request(ca, "PUT", `/blogs/${id1}`, { json: { description: "autosaved", autosave: true } });
    check((await edits()) === before, "autosaves are not logged");
    await request(ca, "PUT", `/blogs/${id1}`, { json: { description: "saved by hand", autosave: false } });
    check((await edits()) === before + 1, "deliberate saves are logged");

    // ---------- other users ----------
    r = await request(cb, "GET", `/blogs/${id1}/edit`);
    check(r.status === 404, "another user cannot open my post");
    r = await request(cb, "PUT", `/blogs/${id1}`, { json: { title: "hijack" } });
    check(r.status === 404, "another user cannot edit my post");
    r = await status(id1, { status: "published" }, cb);
    check(r.status === 404, "another user cannot publish my post");
    r = await request(cb, "DELETE", `/blogs/${id1}`);
    check(r.status === 404, "another user cannot delete my post");
    r = await request(cb, "PUT", `/blogs/${id1}/cover`, { form: imageForm("coverImage") });
    check(r.status === 404, "another user cannot change my cover");
    r = await request(cb, "POST", `/blogs/${id1}/images`, { form: imageForm("image") });
    check(r.status === 404, "another user cannot upload into my post");

    // ---------- publishing ----------
    const id2 = await newDraft();
    r = await status(id2, { status: "published" });
    check(r.status === 422 && r.data.details.length === 3, "an empty post cannot be published (title, content, category)");

    r = await request(ca, "PUT", `/blogs/${id2}`, {
      json: {
        title: `Derived ${tag}`, categories: [String(category._id)], tags: [T],
        content: `<p>Hello &amp; welcome to this post. ${"More text here. ".repeat(30)}</p>`,
      },
    });
    r = await status(id2, { status: "published" });
    check(r.status === 200 && r.data.data.blog.status === "published" && r.data.data.blog.publishedAt, "a ready post can be published");
    const derived = r.data.data.blog.description;
    check(derived.startsWith("Hello & welcome") && derived.length <= 201 && !derived.includes("<"), "an empty description is generated from the text");

    r = await status(id1, { status: "published" });
    check(r.status === 200, "the first post can be published too");
    const live = await publicIds();
    check(live.includes(id1) && live.includes(id2), "published posts appear in the public list");

    const slugBefore = r.data.data.blog.slug;
    r = await request(ca, "PUT", `/blogs/${id1}`, { json: { title: `Renamed ${tag}` } });
    check(r.data.data.blog.slug === slugBefore, "the slug is frozen after publishing");

    r = await status(id1, { status: "published" });
    check(r.status === 400, "publishing an already published post is rejected");
    r = await status(id1, { status: "unpublished" });
    check(r.status === 200 && !(await publicIds()).includes(id1), "unpublishing hides the post");
    r = await status(id1, { status: "published" });
    check(r.status === 200 && (await publicIds()).includes(id1), "an unpublished post can be republished");

    const id3 = await newDraft();
    r = await status(id3, { status: "unpublished" });
    check(r.status === 400, "a draft cannot be unpublished");

    // ---------- scheduling ----------
    await fillIn(id3);
    r = await status(id3, { status: "scheduled" });
    check(r.status === 422, "scheduling without a date is rejected");
    r = await status(id3, { status: "scheduled", scheduledFor: new Date(Date.now() + 60000).toISOString() });
    check(r.status === 422, "scheduling less than 5 minutes ahead is rejected");
    r = await status(id3, { status: "scheduled", scheduledFor: new Date(Date.now() + 2 * 366 * 86400000).toISOString() });
    check(r.status === 422, "scheduling more than a year ahead is rejected");
    r = await status(id3, { status: "scheduled", scheduledFor: new Date(Date.now() + 3600000).toISOString() });
    check(r.status === 200 && r.data.data.blog.status === "scheduled" && !(await publicIds()).includes(id3), "a post can be scheduled (and stays hidden)");

    const due = new Date(Date.now() - 60000);
    await Blog.updateOne({ _id: id3 }, { $set: { scheduledFor: due } });
    check((await publishDueBlogs()) >= 1, "the job publishes due posts");
    const job3 = await Blog.findById(id3);
    check(job3.status === "published" && job3.publishedAt.getTime() === due.getTime() && !job3.scheduledFor, "a job-published post is live with its scheduled time");
    check((await publicIds()).includes(id3), "a job-published post appears publicly");

    const id4 = await newDraft();
    await fillIn(id4);
    await User.updateOne({ _id: A._id }, { restrictions: ["publish"] });
    r = await status(id4, { status: "published" });
    check(r.status === 403 && r.data.code === "PUBLISH_RESTRICTED", "a restricted user cannot publish");
    await User.updateOne({ _id: A._id }, { restrictions: [] });
    await status(id4, { status: "scheduled", scheduledFor: new Date(Date.now() + 3600000).toISOString() });
    await Blog.updateOne({ _id: id4 }, { $set: { scheduledFor: new Date(Date.now() - 60000) } });
    await User.updateOne({ _id: A._id }, { restrictions: ["publish"] });
    await publishDueBlogs();
    check((await Blog.findById(id4)).status === "scheduled", "the job skips authors who are restricted from publishing");
    await User.updateOne({ _id: A._id }, { restrictions: [] });
    await publishDueBlogs();
    check((await Blog.findById(id4)).status === "published", "the job publishes once the restriction is lifted");

    // ---------- images ----------
    r = await request(ca, "PUT", `/blogs/${id1}/cover`, { form: imageForm("coverImage") });
    check(r.status === 200 && Boolean(r.data.data.coverImage.url), "a cover image can be uploaded");
    const firstCover = (await Blog.findById(id1)).coverImage.publicId;
    r = await request(ca, "PUT", `/blogs/${id1}/cover`, { form: imageForm("coverImage") });
    check((await Blog.findById(id1)).coverImage.publicId !== firstCover, "replacing the cover stores the new one");
    r = await request(ca, "PUT", `/blogs/${id1}/cover`, { form: imageForm("coverImage", { bytes: Buffer.from("this is not an image at all") }) });
    check(r.status === 400, "a fake image (wrong file contents) is rejected");
    r = await request(ca, "PUT", `/blogs/${id1}/cover`, { form: imageForm("coverImage", { type: "text/plain" }) });
    check(r.status === 400, "a non-image file type is rejected");
    r = await request(ca, "PUT", `/blogs/${id1}/cover`, { json: {} });
    check(r.status === 400, "uploading without a file is rejected");
    r = await request(ca, "GET", `/blogs/${id1}/edit`);
    check(r.data.data.blog.coverImage.url && !("publicId" in r.data.data.blog.coverImage), "storage ids are never sent to the client");
    r = await request(ca, "DELETE", `/blogs/${id1}/cover`);
    check(r.status === 200 && !(await Blog.findById(id1)).coverImage?.url, "the cover can be removed");

    r = await request(ca, "POST", `/blogs/${id1}/images`, { form: imageForm("image") });
    check(r.status === 200 && Boolean(r.data.data.url), "an inline image can be uploaded");
    const inline = r.data.data;
    inlineImageIds.push(inline.publicId);
    r = await request(ca, "PUT", `/blogs/${id1}`, { json: { content: `${LONG}<img src="${inline.url}" alt="ok">` } });
    check(r.data.data.blog.content.includes(inline.url), "images from our own storage are kept in the content");

    // ---------- my posts and edit view ----------
    await request(cb, "POST", "/blogs", { json: { title: "Someone else's draft" } });
    r = await request(ca, "GET", "/blogs/mine");
    check(r.status === 200 && r.data.data.every((b) => !("content" in b)), "my posts list works and has no full content");
    const mineIds = r.data.data.map((b) => b._id);
    check([id1, id2, id3, id4].every((id) => mineIds.includes(id)), "my posts list contains my posts");
    check(!r.data.data.some((b) => b.title === "Someone else's draft"), "my posts list never contains other people's posts");
    const c = r.data.meta.counts;
    check(c.published >= 4 && c.draft >= 0 && Object.values(c).reduce((a, b) => a + b, 0) === r.data.meta.total, "status counts add up for the dashboard tabs");
    r = await request(ca, "GET", "/blogs/mine?status=published");
    check(r.data.data.length > 0 && r.data.data.every((b) => b.status === "published"), "my posts can be filtered by status");
    check((await request(ca, "GET", "/blogs/mine?status=hacked")).status === 422, "an unknown status filter is rejected");
    r = await request(ca, "GET", `/blogs/${id2}/edit`);
    check(r.status === 200 && r.data.data.blog.content.includes("Hello"), "the edit view returns the full content");

    // ---------- moderation locks ----------
    const id5 = await newDraft();
    await fillIn(id5);
    await status(id5, { status: "published" });
    await Blog.updateOne({ _id: id5 }, { $set: { status: "unpublished", moderation: { by: B._id, reason: "Breaks the rules", at: new Date() } } });
    r = await status(id5, { status: "published" });
    check(r.status === 403 && r.data.code === "BLOG_MODERATED", "the author cannot republish a moderator-unpublished post");
    r = await request(ca, "GET", `/blogs/${id5}/edit`);
    check(r.data.data.blog.moderation.reason === "Breaks the rules" && !("by" in r.data.data.blog.moderation), "the author sees the reason but not which admin acted");
    await Blog.updateOne({ _id: id5 }, { $set: { status: "removed" } });
    r = await request(ca, "PUT", `/blogs/${id5}`, { json: { title: "Edit after removal" } });
    check(r.status === 403, "a removed post cannot be edited");

    // ---------- delete ----------
    r = await request(ca, "DELETE", `/blogs/${id1}`);
    check(r.status === 200, "a post can be deleted");
    check(!(await publicIds()).includes(id1), "a deleted post disappears from the public list");
    check((await request(ca, "GET", `/blogs/${id1}/edit`)).status === 404, "a deleted post cannot be opened");
    check(!(await request(ca, "GET", "/blogs/mine")).data.data.some((b) => b._id === id1), "a deleted post disappears from my posts");
    check((await request(ca, "DELETE", `/blogs/${id1}`)).status === 404, "deleting twice returns 404");
    check(Boolean((await Blog.findById(id1)).deletedAt), "deletion is soft (the post can be restored later)");

    console.log(`\nAll ${passed} checks passed 🎉`);
  } finally {
    const userIds = users.map((u) => u._id);
    const blogs = await Blog.find({ author: { $in: userIds } }).select("coverImage").lean();
    for (const b of blogs) await deleteImage(b.coverImage?.publicId);
    for (const publicId of inlineImageIds) await deleteImage(publicId);
    await Promise.all([
      Blog.deleteMany({ author: { $in: userIds } }),
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