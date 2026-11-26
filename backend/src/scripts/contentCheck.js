import { connectDB, disconnectDB } from "../config/db.js";
import { Role, Permission, Category, Blog, Notification, AdminAuditLog } from "../models/index.js";
import { ALL_PERMISSIONS } from "../constants/permissions.js";
import { makeKit, GHOST_ID } from "./testKit.js";

const kit = makeKit();
const { tag, check, call, mkUser, login } = kit;
const why = { reason: "Testing the moderation tools" };
const DAY = 86400000;

const run = async () => {
  await connectDB();
  const blogIds = [];
  let csa = null;
  let adminRoleId = null;
  let originalKeys = null;

  try {
    // the new permissions must be installed first
    const installed = await Permission.countDocuments({ key: { $in: ALL_PERMISSIONS } });
    const adminRole = await Role.findOne({ name: "admin" }).populate("permissions", "key").lean();
    const adminKeys = new Set((adminRole?.permissions || []).map((p) => p.key));
    if (installed < ALL_PERMISSIONS.length || !adminKeys.has("comments:moderate")) {
      throw new Error("Run `npm run seed:roles` first (it installs the Phase 13 permissions), then restart the server.");
    }
    if (adminKeys.has("blogs:feature") || adminKeys.has("roles:manage")) {
      throw new Error("This test expects the default Admin permissions.");
    }

    const SA = await mkUser("sa", { role: "super_admin" });
    const AD = await mkUser("ad", { role: "admin" });
    const AU = await mkUser("au");
    await mkUser("rd");
    const [csa_, cad, cau] = await Promise.all([SA, AD, AU].map(login));
    csa = csa_;
    check([csa, cad, cau].every(Boolean), "test users can log in");

    /* ===================== roles and permissions ===================== */
    check((await call(cad, "GET", "/admin/roles")).status === 403, "an admin without roles:manage cannot list roles");
    let r = await call(csa, "GET", "/admin/roles");
    const roles = Object.fromEntries(r.data.data.map((x) => [x.name, x]));
    adminRoleId = roles.admin._id;
    originalKeys = roles.admin.permissions;
    check(
      r.status === 200 && roles.super_admin.permissions.length === ALL_PERMISSIONS.length &&
        roles.super_admin.locked && roles.user.locked && !roles.admin.locked,
      "a super admin sees all roles (Super Admin and User are locked)"
    );
    check(roles.admin.users >= 1 && roles.admin.isSystem === true, "roles show how many users hold them");
    r = await call(csa, "GET", "/admin/permissions");
    check(r.data.data.length === ALL_PERMISSIONS.length && r.data.data.every((p) => p.description && p.group), "the permission catalogue has descriptions");
    r = await call(cad, "GET", "/admin/me/permissions");
    check(
      r.status === 200 && r.data.data.role === "admin" && r.data.data.permissions.includes("analytics:view") &&
        !r.data.data.permissions.includes("roles:manage"),
      "an admin can see their own permissions"
    );
    check((await call(cau, "GET", "/admin/me/permissions")).status === 403, "a regular user cannot");

    const putPerms = (cookie, keys, body = why) =>
      call(cookie, "PUT", `/admin/roles/${adminRoleId}/permissions`, { permissions: keys, ...body });

    check((await putPerms(cad, originalKeys)).status === 403, "an admin cannot edit permissions");
    check((await putPerms(csa, originalKeys)).status === 400, "saving the same permissions is rejected");
    check((await putPerms(csa, originalKeys, {})).status === 422, "a reason is required");
    check((await putPerms(csa, ["not:real"])).status === 422, "an unknown permission is rejected");
    check((await call(csa, "PUT", `/admin/roles/${roles.super_admin._id}/permissions`, { permissions: [], ...why })).status === 400, "the Super Admin role cannot be edited");
    check((await call(csa, "PUT", `/admin/roles/${roles.user._id}/permissions`, { permissions: [], ...why })).status === 400, "the User role cannot be edited");

    check((await call(cad, "GET", "/admin/dashboard")).status === 200, "the admin can open the dashboard");
    r = await putPerms(csa, originalKeys.filter((k) => k !== "analytics:view"));
    check(r.status === 200 && !r.data.data.role.permissions.includes("analytics:view"), "a super admin can remove a permission");
    check((await call(cad, "GET", "/admin/dashboard")).status === 403, "the change takes effect immediately");
    await putPerms(csa, originalKeys);
    check((await call(cad, "GET", "/admin/dashboard")).status === 200, "and so does adding it back");

    r = await putPerms(csa, [...originalKeys, "roles:manage"]);
    check(r.status === 200, "a super admin can grant roles:manage");
    check((await call(cad, "GET", "/admin/roles")).status === 200, "the admin can now view roles");
    check((await putPerms(cad, originalKeys)).status === 403, "but still cannot edit them (no self-promotion)");
    await putPerms(csa, originalKeys);
    const permLog = await AdminAuditLog.findOne({ admin: SA._id, action: "role.permissions_update", "newValue.added": "roles:manage" });
    check(permLog && permLog.previousValue.permissions.length === originalKeys.length && permLog.reason === why.reason, "permission changes are audited with before and after");
    check((await Notification.countDocuments({ recipient: AD._id, type: "admin_announcement" })) >= 1, "admins are told when their permissions change");

    /* ===================== blog moderation ===================== */
    let n = 0;
    const mkBlog = async (extra = {}) => {
      const blog = await Blog.create({
        author: AU._id, title: `Mod post ${++n} ${tag}`, slug: `mod-post-${n}-${tag}`, description: "check",
        content: `<p>${"Body text. ".repeat(10)}</p>`, tags: [`tg${tag}`], status: "published",
        publishedAt: new Date(Date.now() - 3600000), readingTime: 1, ...extra,
      });
      blogIds.push(blog._id);
      return blog;
    };
    const b1 = await mkBlog({ isFeatured: true, featuredAt: new Date() });
    const b2 = await mkBlog();
    const b3 = await mkBlog({ status: "draft", publishedAt: undefined });
    const b4 = await mkBlog();
    const b5 = await mkBlog();
    const publicIds = async () => (await call(null, "GET", `/blogs?tag=tg${tag}&limit=50`)).data.data.map((b) => b._id);
    const authorNotes = (extra = {}) => Notification.countDocuments({ recipient: AU._id, type: "admin_blog_action", ...extra });

    // ----- browsing -----
    r = await call(cad, "GET", `/admin/blogs?q=${tag}&limit=50`);
    check(r.status === 200 && r.data.meta.total === 4 && r.data.data.every((x) => x.status !== "draft"), "an admin sees all posts except private drafts");
    const row = r.data.data[0];
    check(row.author.username === AU.username && !("content" in row) && typeof row.views === "number", "rows show the author and stats, never the content");
    check(!("draft" in r.data.meta.counts) && r.data.meta.counts.published >= 4, "status counts hide the draft number from admins without draft access");
    check((await call(cad, "GET", `/admin/blogs?q=${tag}&status=draft`)).status === 403, "an admin cannot filter for private drafts");
    check((await call(csa, "GET", `/admin/blogs?q=${tag}&limit=50`)).data.meta.total === 5, "a super admin sees drafts too");
    check((await call(csa, "GET", `/admin/blogs?q=${tag}&featured=true`)).data.meta.total === 1, "the featured filter works");
    check((await call(csa, "GET", `/admin/blogs?q=${tag}&author=${AU.username}`)).data.meta.total === 5, "the author filter works");
    check((await call(cad, "GET", "/admin/blogs?status=hacked")).status === 422, "an unknown status filter is rejected");

    r = await call(cad, "GET", `/admin/blogs/${b1._id}`);
    check(r.status === 200 && r.data.data.blog.content.includes("Body text") && r.data.data.blog.tags.includes(`tg${tag}`), "an admin can open a post with its full content");
    check((await call(cad, "GET", `/admin/blogs/${b3._id}`)).status === 403, "an admin cannot open someone's private draft");
    check((await call(csa, "GET", `/admin/blogs/${b3._id}`)).status === 200, "a super admin can");
    check(Boolean(await AdminAuditLog.findOne({ admin: SA._id, action: "blog.view_draft", targetId: b3._id })), "opening a draft is audited");
    check((await call(csa, "GET", `/admin/blogs/${GHOST_ID}`)).status === 404, "an unknown post gives 404");

    // ----- editing -----
    const dirty = "<p>Clean text</p><script>alert(1)</script><img src=\"https://evil.example/x.png\" onerror=\"alert(1)\">";
    r = await call(cad, "PUT", `/admin/blogs/${b1._id}`, { title: `Edited ${tag}`, content: dirty, ...why });
    check(r.status === 200 && r.data.data.blog.title === `Edited ${tag}`, "an admin can edit a post");
    const edited = await Blog.findById(b1._id);
    check(!/<script|onerror|evil\.example/.test(edited.content) && edited.slug === b1.slug, "admin edits are sanitized and keep the slug");
    check((await authorNotes({ message: /edited/ })) >= 1, "the author is notified of the edit");
    const editLog = await AdminAuditLog.findOne({ admin: AD._id, action: "blog.edit", targetId: b1._id });
    check(editLog.previousValue.title === b1.title && editLog.newValue.title === `Edited ${tag}` && editLog.reason === why.reason, "the edit is audited with before and after");
    check((await call(cad, "PUT", `/admin/blogs/${b1._id}`, { title: "No reason" })).status === 422, "an edit needs a reason");
    check((await call(cad, "PUT", `/admin/blogs/${b1._id}`, { ...why })).status === 400, "an edit that changes nothing is rejected");
    check((await call(cad, "PUT", `/admin/blogs/${b3._id}`, { title: "Draft edit", ...why })).status === 403, "an admin cannot edit a private draft");

    // ----- unpublish, remove, restore -----
    const setStatus = (cookie, id, status, body = why) => call(cookie, "PATCH", `/admin/blogs/${id}/status`, { status, ...body });
    check((await publicIds()).includes(String(b1._id)), "the post is public before moderation");
    r = await setStatus(cad, b1._id, "unpublished");
    check(r.status === 200 && r.data.data.blog.status === "unpublished" && r.data.data.blog.moderation.by === AD.username, "an admin can unpublish a post");
    check(!(await publicIds()).includes(String(b1._id)), "an unpublished post disappears");
    check((await Blog.findById(b1._id)).isFeatured === false, "unpublishing removes the featured flag");
    check((await call(null, "GET", `/blogs/${b1.slug}`)).status === 404, "its page is gone for visitors");
    r = await call(cau, "PATCH", `/blogs/${b1._id}/status`, { status: "published" });
    check(r.status === 403 && r.data.code === "BLOG_MODERATED", "the author cannot republish a moderated post");
    r = await call(cau, "GET", `/blogs/${b1._id}/edit`);
    check(r.data.data.blog.moderation.reason === why.reason && !("by" in r.data.data.blog.moderation), "the author sees the reason but not which admin acted");
    check((await authorNotes({ message: /unpublished/ })) >= 1, "the author is notified of the unpublishing");
    check(Boolean(await AdminAuditLog.findOne({ action: "blog.unpublish", targetId: b1._id })), "unpublishing is audited");
    check((await setStatus(cad, b4._id, "published")).status === 400, "a post that wasn't moderated cannot be 'restored'");
    check((await setStatus(cad, b3._id, "unpublished")).status === 403, "a draft cannot be moderated by an admin without draft access");

    r = await setStatus(cad, b2._id, "removed");
    check(r.status === 200 && r.data.data.blog.status === "removed", "an admin with blogs:delete_any can remove a post");
    r = await call(cau, "PUT", `/blogs/${b2._id}`, { title: "Edit after removal" });
    check(r.status === 403, "the author cannot edit a removed post");
    check((await setStatus(cad, b2._id, "removed")).status === 400, "removing twice is rejected");

    r = await setStatus(csa, b1._id, "published", { reason: "Appeal accepted" });
    check(r.status === 200 && r.data.data.blog.status === "published" && !r.data.data.blog.moderation, "a moderated post can be restored");
    check((await publicIds()).includes(String(b1._id)), "a restored post is public again");
    check(Boolean(await AdminAuditLog.findOne({ action: "blog.restore", targetId: b1._id })), "the restore is audited");

    // ----- featuring -----
    r = await call(cad, "PATCH", `/admin/blogs/${b4._id}/feature`, { featured: true, ...why });
    check(r.status === 403 && r.data.code === "PERMISSION_DENIED", "an admin cannot feature posts by default");
    r = await call(csa, "PATCH", `/admin/blogs/${b4._id}/feature`, { featured: true, ...why });
    check(r.status === 200 && r.data.data.blog.isFeatured === true, "a super admin can feature a post");
    check(((await call(null, "GET", "/blogs/featured?limit=20")).data.data || []).some((b) => b._id === String(b4._id)), "featured posts appear on the featured list");
    check((await call(csa, "PATCH", `/admin/blogs/${b4._id}/feature`, { featured: true, ...why })).status === 400, "featuring twice is rejected");
    check((await call(csa, "PATCH", `/admin/blogs/${b2._id}/feature`, { featured: true, ...why })).status === 400, "a removed post cannot be featured");
    check((await call(csa, "PATCH", `/admin/blogs/${b4._id}/feature`, { featured: false, ...why })).status === 200, "a post can be unfeatured");

    // ----- delete and restore -----
    check((await call(cad, "DELETE", `/admin/blogs/${b5._id}`, {})).status === 422, "a delete needs a reason");
    r = await call(cad, "DELETE", `/admin/blogs/${b5._id}`, why);
    const deleted = await Blog.findById(b5._id);
    check(r.status === 200 && deleted.deletedAt && String(deleted.moderation.by) === String(AD._id), "an admin can delete a post (soft delete)");
    check(!(await publicIds()).includes(String(b5._id)) && (await call(null, "GET", `/blogs/${b5.slug}`)).status === 404, "a deleted post is gone for visitors");
    check((await call(cad, "GET", `/admin/blogs?q=${tag}&deleted=only`)).data.data.some((x) => x._id === String(b5._id)), "deleted posts can be listed");
    check((await authorNotes({ message: /deleted/ })) >= 1, "the author is notified of the deletion");

    r = await call(cad, "POST", `/admin/blogs/${b5._id}/restore`, why);
    check(r.status === 200 && r.data.data.blog.deleted === false && !(await Blog.findById(b5._id)).deletedAt, "a moderator-deleted post can be restored");
    check((await publicIds()).includes(String(b5._id)), "a restored post is public again");
    check((await call(cad, "POST", `/admin/blogs/${b5._id}/restore`, why)).status === 404, "restoring a post that isn't deleted gives 404");
    const byAuthor = await mkBlog({ deletedAt: new Date() });
    r = await call(csa, "POST", `/admin/blogs/${byAuthor._id}/restore`, why);
    check(r.status === 400 && r.data.code === "DELETED_BY_AUTHOR", "a post deleted by its author cannot be restored by admins");
    const tooOld = await mkBlog({ deletedAt: new Date(Date.now() - 31 * DAY), moderation: { by: AD._id, reason: "old", at: new Date(Date.now() - 31 * DAY) } });
    r = await call(csa, "POST", `/admin/blogs/${tooOld._id}/restore`, why);
    check(r.status === 400 && r.data.code === "RESTORE_WINDOW_PASSED", "restoring after 30 days is rejected");

    /* ===================== categories ===================== */
    const nameA = `Mod ${tag} A`;
    const nameB = `Mod ${tag} B`;
    check((await call(cad, "POST", "/admin/categories", { name: nameA })).status === 403, "an admin cannot manage categories by default");
    r = await call(csa, "POST", "/admin/categories", { name: nameA, description: "A test category" });
    const catA = r.data.data.category;
    check(r.status === 201 && catA.slug === `mod-${tag}-a` && catA.isActive === true, "a super admin can create a category");
    check((await call(csa, "POST", "/admin/categories", { name: nameA })).status === 409, "a duplicate name is rejected");
    check((await call(csa, "POST", "/admin/categories", { name: "x" })).status === 422, "a too-short name is rejected");
    r = await call(csa, "POST", "/admin/categories", { name: nameB });
    const catB = r.data.data.category;

    r = await call(csa, "PUT", `/admin/categories/${catA._id}`, { name: `${nameA} renamed`, description: "Changed" });
    check(r.status === 200 && r.data.data.category.name === `${nameA} renamed` && r.data.data.category.slug === catA.slug, "a category can be renamed (the slug stays)");
    check((await call(csa, "PUT", `/admin/categories/${catA._id}`, { name: nameB })).status === 409, "renaming to an existing name is rejected");
    await Blog.updateOne({ _id: b4._id }, { categories: [catA._id] });
    check((await call(csa, "DELETE", `/admin/categories/${catA._id}`, {})).data.code === "CATEGORY_IN_USE", "a category that posts use cannot be deleted");
    r = await call(csa, "PUT", `/admin/categories/${catA._id}`, { isActive: false });
    check(r.data.data.category.isActive === false && r.data.data.category.posts === 1, "it can be deactivated instead");
    r = await call(csa, "GET", "/admin/categories");
    check(r.data.data.find((c) => c._id === catA._id)?.isActive === false, "the admin list includes inactive categories");
    const publicSlugs = (await call(null, "GET", "/categories")).data.data.map((c) => c.slug);
    check(publicSlugs.includes(catB.slug) && !publicSlugs.includes(catA.slug), "the public list shows only active categories");
    await Blog.updateOne({ _id: b4._id }, { categories: [] });
    check((await call(csa, "DELETE", `/admin/categories/${catA._id}`, { reason: "Cleanup" })).status === 200, "an unused category can be deleted");
    check(Boolean(await AdminAuditLog.findOne({ action: "category.delete", targetId: catA._id })), "category changes are audited");

    kit.done();
  } finally {
    // put the Admin role back exactly as it was (through the API, so the server's cache is refreshed too)
    if (csa && adminRoleId && originalKeys) {
      await call(csa, "PUT", `/admin/roles/${adminRoleId}/permissions`, {
        permissions: originalKeys, reason: "Restoring the original permissions after the test",
      }).catch(() => {});
    }
    await Promise.all([
      Blog.deleteMany({ _id: { $in: blogIds } }),
      Category.deleteMany({ name: { $regex: `^Mod ${tag}` } }),
    ]);
    await kit.cleanupUsers();
    await disconnectDB();
  }
};

run().catch((err) => {
  console.error(err.message);
  process.exit(1);
});