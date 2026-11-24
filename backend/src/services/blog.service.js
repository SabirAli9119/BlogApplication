import { Blog, Category, User, UserPreference, ReadingHistory } from "../models/index.js";
import { BLOG_STATUS } from "../constants/eventTypes.js";
import { ACCOUNT_STATUS } from "../constants/roles.js";
import { getPagination, buildMeta } from "../utils/pagination.js";

// Only the fields a blog CARD needs. Never the full content, never private author data.
const CARD_FIELDS =
  "title slug description coverImage.url author categories tags readingTime publishedAt likesCount commentsCount views isFeatured";
const CARD_PROJECTION = {
  title: 1, slug: 1, description: 1, "coverImage.url": 1, author: 1, categories: 1, tags: 1,
  readingTime: 1, publishedAt: 1, likesCount: 1, commentsCount: 1, views: 1, isFeatured: 1,
};
const POPULATE = [
  { path: "author", select: "username firstName lastName avatar.url headline isVerifiedBadge" },
  { path: "categories", select: "name slug" },
];

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Authors whose posts must not appear in public lists:
 * suspended/banned/deactivated/deleted accounts and private profiles.
 * (A viewer always still sees their own posts.)
 * Fine for a portfolio-sized app; at very large scale you would denormalize
 * a visibility flag onto each blog instead.
 */
export const getHiddenAuthorIds = async (viewerId) => {
  const [inactive, privateProfiles] = await Promise.all([
    User.find({
      $or: [{ status: { $ne: ACCOUNT_STATUS.ACTIVE } }, { deletedAt: { $exists: true } }],
    }).distinct("_id"),
    UserPreference.find({ "privacy.profileVisibility": "private" }).distinct("user"),
  ]);
  const me = viewerId ? String(viewerId) : null;
  return [...inactive, ...privateProfiles].filter((id) => String(id) !== me);
};

const resolveHidden = (hidden, viewerId) => hidden ?? getHiddenAuthorIds(viewerId);

// The one definition of "publicly visible".
const publicFilter = (hidden) => ({
  status: BLOG_STATUS.PUBLISHED,
  deletedAt: { $exists: false },
  publishedAt: { $lte: new Date() },
  ...(hidden.length && { author: { $nin: hidden } }),
});

const emptyPage = (page, limit) => ({ items: [], meta: buildMeta(0, page, limit) });

export const listBlogs = async ({ query, viewerId, hidden }) => {
  const { page, limit, skip } = getPagination(query, 10, 50);
  hidden = await resolveHidden(hidden, viewerId);
  const filter = publicFilter(hidden);

  if (query.category) {
    const category = await Category.findOne({ slug: query.category, isActive: true }).select("_id").lean();
    if (!category) return emptyPage(page, limit);
    filter.categories = category._id;
  }
  if (query.tag) filter.tags = query.tag;
  if (query.author) {
    const author = await User.findOne({ username: query.author }).select("_id").lean();
    if (!author || hidden.some((id) => String(id) === String(author._id))) return emptyPage(page, limit);
    filter.author = author._id;
  }

  const hasSearch = Boolean(query.q);
  if (hasSearch) filter.$text = { $search: query.q };

  const mode = query.sort || (hasSearch ? "relevance" : "latest");
  let sort = { publishedAt: -1 };
  if (mode === "popular") sort = { views: -1, publishedAt: -1 };
  if (mode === "relevance" && hasSearch) sort = { score: { $meta: "textScore" }, publishedAt: -1 };

  const [rows, total] = await Promise.all([
    Blog.find(filter, hasSearch ? { score: { $meta: "textScore" } } : null)
      .select(CARD_FIELDS)
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .populate(POPULATE)
      .lean(),
    Blog.countDocuments(filter),
  ]);

  const items = rows.map(({ score, ...blog }) => blog); // the text score is internal
  return { items, meta: buildMeta(total, page, limit) };
};

export const getTrending = async ({ limit = 10, viewerId, hidden }) => {
  hidden = await resolveHidden(hidden, viewerId);
  const now = new Date();
  const since = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const rows = await Blog.aggregate([
    { $match: { ...publicFilter(hidden), publishedAt: { $gte: since, $lte: now } } },
    {
      $addFields: {
        score: {
          $divide: [
            { $add: [{ $multiply: ["$likesCount", 3] }, { $multiply: ["$commentsCount", 2] }, "$views"] },
            { $pow: [{ $add: [{ $divide: [{ $subtract: [now, "$publishedAt"] }, 3600000] }, 2] }, 1.5] },
          ],
        },
      },
    },
    { $sort: { score: -1, publishedAt: -1 } },
    { $limit: limit },
    { $project: CARD_PROJECTION },
  ]);
  return Blog.populate(rows, POPULATE);
};

export const getFeatured = async ({ limit = 5, viewerId, hidden }) => {
  hidden = await resolveHidden(hidden, viewerId);
  return Blog.find({ ...publicFilter(hidden), isFeatured: true })
    .select(CARD_FIELDS)
    .sort({ featuredAt: -1, publishedAt: -1 })
    .limit(limit)
    .populate(POPULATE)
    .lean();
};

export const getRecommended = async ({ limit = 10, viewerId, hidden }) => {
  hidden = await resolveHidden(hidden, viewerId);
  const base = publicFilter(hidden);
  if (viewerId) base.author = { $nin: [...hidden, viewerId] }; // not your own posts

  const fetchPosts = (filter) =>
    Blog.find(filter).select(CARD_FIELDS).sort({ views: -1, publishedAt: -1 }).limit(limit).populate(POPULATE).lean();

  if (viewerId) {
    const [prefs, history] = await Promise.all([
      UserPreference.findOne({ user: viewerId }).select("blogging.favoriteCategories blogging.topics").lean(),
      ReadingHistory.find({ user: viewerId }).sort({ lastReadAt: -1 }).limit(200).select("blog").lean(),
    ]);
    const categories = prefs?.blogging?.favoriteCategories || [];
    const topics = prefs?.blogging?.topics || [];

    if (categories.length || topics.length) {
      const items = await fetchPosts({
        ...base,
        _id: { $nin: history.map((h) => h.blog) },
        $or: [{ categories: { $in: categories } }, { tags: { $in: topics } }],
      });
      if (items.length) return { items, reason: "preferences" };
    }
  }
  return { items: await fetchPosts(base), reason: "popular" };
};

export const listCategories = () =>
  Category.find({ isActive: true }).sort({ sortOrder: 1, name: 1 }).select("name slug description").lean();

export const getPopularCategories = async ({ limit = 8 }) => {
  const hidden = await getHiddenAuthorIds(null);
  return Blog.aggregate([
    { $match: publicFilter(hidden) },
    { $unwind: "$categories" },
    { $group: { _id: "$categories", count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $lookup: { from: "categories", localField: "_id", foreignField: "_id", as: "category" } },
    { $unwind: "$category" },
    { $match: { "category.isActive": true } },
    { $limit: limit },
    { $project: { _id: "$category._id", name: "$category.name", slug: "$category.slug", count: 1 } },
  ]);
};

export const getSearchSuggestions = async ({ q, viewerId }) => {
  const hidden = await getHiddenAuthorIds(viewerId);
  const safe = escapeRegex(q);
  const filter = publicFilter(hidden);
  const [blogs, tags] = await Promise.all([
    Blog.find({ ...filter, title: { $regex: safe, $options: "i" } })
      .sort({ views: -1 })
      .limit(5)
      .select("title slug")
      .lean(),
    Blog.distinct("tags", { ...filter, tags: { $regex: `^${safe}` } }),
  ]);
  return { blogs, tags: tags.slice(0, 5) };
};

export const getHome = async ({ viewerId }) => {
  const hidden = await getHiddenAuthorIds(viewerId); // computed once, shared by all sections
  const [featured, latest, trending, popularCategories, recommended] = await Promise.all([
    getFeatured({ limit: 5, hidden }),
    listBlogs({ query: { page: 1, limit: 8 }, hidden }).then((r) => r.items),
    getTrending({ limit: 6, hidden }),
    getPopularCategories({ limit: 8 }),
    getRecommended({ limit: 6, viewerId, hidden }),
  ]);
  return { featured, latest, trending, popularCategories, recommended };
};