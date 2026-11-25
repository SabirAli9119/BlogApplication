import { User, UserPreference, Blog, Follow } from "../models/index.js";
import { EVENTS } from "../constants/eventTypes.js";
import { ApiError } from "../utils/ApiError.js";
import { toPlainText } from "../utils/sanitizeHtml.js";
import { publicFilter, CARD_FIELDS, POPULATE } from "./blog.service.js";
import { resolveUser } from "./userVisibility.service.js";
import { uploadImage, deleteImage } from "./upload.service.js";
import { logActivity } from "./activity.service.js";

const urlOf = (image) => (image?.url ? { url: image.url } : undefined);
const CONTACT_FIELDS = ["country", "state", "city", "postalCode", "timezone"];

/* ---------- public profile ---------- */

export const getProfile = async ({ identifier, viewerId }) => {
  const user = await resolveUser(identifier);
  const isSelf = Boolean(viewerId) && String(user._id) === String(viewerId);

  const [prefs, followEdge] = await Promise.all([
    UserPreference.findOne({ user: user._id })
      .populate({ path: "blogging.favoriteCategories", match: { isActive: true }, select: "name slug" })
      .lean(),
    viewerId && !isSelf ? Follow.exists({ follower: viewerId, following: user._id }) : null,
  ]);

  const privacy = prefs?.privacy || {};
  const isPrivate = privacy.profileVisibility === "private";
  const viewer = {
    isSelf,
    isFollowing: Boolean(followEdge),
    canFollow: Boolean(viewerId) && !isSelf && !isPrivate && privacy.allowFollowers !== false,
  };

  // A private profile shows only a name and picture to everyone except its owner.
  if (isPrivate && !isSelf) {
    return {
      _id: user._id,
      username: user.username,
      firstName: user.firstName,
      lastName: user.lastName,
      avatar: urlOf(user.avatar),
      isVerifiedBadge: user.isVerifiedBadge,
      isPrivate: true,
      viewer,
    };
  }

  const mine = { ...publicFilter([]), author: user._id };
  const [[totals], featured] = await Promise.all([
    Blog.aggregate([
      { $match: mine },
      { $group: { _id: null, articles: { $sum: 1 }, likes: { $sum: "$likesCount" }, views: { $sum: "$views" } } },
    ]),
    // platform-featured posts first, then the most viewed
    Blog.find(mine)
      .select(CARD_FIELDS)
      .sort({ isFeatured: -1, views: -1, publishedAt: -1 })
      .limit(3)
      .populate(POPULATE)
      .lean(),
  ]);

  // only what the user chose to share; state, postal code and time zone are never public
  const location = {};
  if (privacy.showCountryPublic && user.contact?.country) location.country = user.contact.country;
  if (privacy.showCityPublic && user.contact?.city) location.city = user.contact.city;

  return {
    _id: user._id,
    username: user.username,
    firstName: user.firstName,
    lastName: user.lastName,
    avatar: urlOf(user.avatar),
    coverPicture: urlOf(user.coverPicture),
    headline: user.headline,
    bio: user.bio,
    isVerifiedBadge: user.isVerifiedBadge,
    joinedAt: user.createdAt,
    ...(Object.keys(location).length && { location }),
    ...(privacy.showActivity && user.lastLoginAt && { lastActiveAt: user.lastLoginAt }),
    ...(isSelf && { isPrivate }),
    stats: {
      articles: totals?.articles || 0,
      likes: totals?.likes || 0,
      views: totals?.views || 0,
      followers: user.followersCount,
      following: user.followingCount,
    },
    featuredArticles: featured,
    interests: {
      categories: (prefs?.blogging?.favoriteCategories || []).map((c) => ({ _id: c._id, name: c.name, slug: c.slug })),
      topics: prefs?.blogging?.topics || [],
    },
    viewer,
  };
};

/* ---------- editing ---------- */

export const updateProfile = async ({ user, input, device }) => {
  const set = {};

  for (const field of ["firstName", "lastName"]) {
    if (input[field] === undefined) continue;
    const clean = toPlainText(input[field]);
    if (!clean) throw new ApiError(422, "Validation failed", [{ field, message: "This field can't be empty" }]);
    set[field] = clean;
  }
  for (const field of ["bio", "headline"]) {
    if (input[field] !== undefined) set[field] = toPlainText(input[field]);
  }
  // dotted paths, so updating the city doesn't wipe the country
  for (const field of CONTACT_FIELDS) {
    if (input.contact?.[field] !== undefined) set[`contact.${field}`] = toPlainText(input.contact[field]);
  }
  if (Object.keys(set).length === 0) return user;

  const updated = await User.findByIdAndUpdate(
    user._id,
    { $set: set },
    { returnDocument: "after", runValidators: true }
  );
  await logActivity({ user: user._id, event: EVENTS.PROFILE_UPDATE, device, resourceType: "user", resourceId: user._id });
  return updated;
};

/* ---------- pictures ---------- */

const replaceImage = async ({ user, file, field, folder, device }) => {
  if (!file) throw ApiError.badRequest("Choose an image to upload");

  const image = await uploadImage(file, folder);
  const previous = user[field]?.publicId;
  try {
    await User.updateOne({ _id: user._id }, { $set: { [field]: image } });
  } catch (err) {
    await deleteImage(image.publicId);
    throw err;
  }
  await deleteImage(previous); // don't keep replaced pictures around
  await logActivity({ user: user._id, event: EVENTS.PROFILE_UPDATE, device, resourceType: "user", resourceId: user._id });
  return { [field]: { url: image.url } };
};

export const setAvatar = ({ user, file, device }) =>
  replaceImage({ user, file, field: "avatar", folder: "blogify/avatars", device });

export const setCover = ({ user, file, device }) =>
  replaceImage({ user, file, field: "coverPicture", folder: "blogify/covers", device });

export const removeAvatar = async ({ user, device }) => {
  const previous = user.avatar?.publicId;
  await User.updateOne({ _id: user._id }, { $unset: { avatar: "" } });
  await deleteImage(previous);
  await logActivity({ user: user._id, event: EVENTS.PROFILE_UPDATE, device, resourceType: "user", resourceId: user._id });
};