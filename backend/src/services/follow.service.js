import { User, UserPreference, Follow } from "../models/index.js";
import { NOTIFICATION_TYPES } from "../constants/eventTypes.js";
import { ApiError } from "../utils/ApiError.js";
import { getPagination, buildMeta } from "../utils/pagination.js";
import { resolveUser, getInactiveUserIds } from "./userVisibility.service.js";
import { notifyIfAllowed } from "./notification.service.js";

const CARD_SELECT = "username firstName lastName avatar.url headline isVerifiedBadge";

const toCard = (u) => ({
  _id: u._id,
  username: u.username,
  firstName: u.firstName,
  lastName: u.lastName,
  avatar: u.avatar?.url ? { url: u.avatar.url } : undefined,
  headline: u.headline,
  isVerifiedBadge: u.isVerifiedBadge,
});

export const followUser = async ({ user, identifier }) => {
  const target = await resolveUser(identifier); // suspended, banned and deleted users give 404
  if (String(target._id) === String(user._id)) throw ApiError.badRequest("You can't follow yourself");

  const prefs = await UserPreference.findOne({ user: target._id }).select("privacy").lean();
  if (prefs?.privacy?.profileVisibility === "private") {
    throw ApiError.forbidden("This profile is private", "PROFILE_PRIVATE");
  }
  if (prefs?.privacy?.allowFollowers === false) {
    throw ApiError.forbidden("This user doesn't accept new followers", "FOLLOWERS_DISABLED");
  }

  // The unique index decides: only the request that really creates the follow changes the counters.
  let created = false;
  try {
    await Follow.create({ follower: user._id, following: target._id });
    created = true;
  } catch (err) {
    if (err.code !== 11000) throw err;
  }

  let followersCount = target.followersCount;
  if (created) {
    const [updated] = await Promise.all([
      User.findByIdAndUpdate(target._id, { $inc: { followersCount: 1 } }, { returnDocument: "after" }).select("followersCount"),
      User.updateOne({ _id: user._id }, { $inc: { followingCount: 1 } }),
    ]);
    followersCount = updated.followersCount;

    await notifyIfAllowed({
      recipient: target._id,
      sender: user._id,
      type: NOTIFICATION_TYPES.NEW_FOLLOWER,
      message: `${user.firstName} ${user.lastName} started following you`,
      resource: { kind: "user", id: user._id },
      dedupe: true, // follow, unfollow, follow again = still one notification
    });
  }
  return { following: true, followersCount };
};

export const unfollowUser = async ({ user, identifier }) => {
  const target = await resolveUser(identifier, { activeOnly: false });

  const removed = await Follow.deleteOne({ follower: user._id, following: target._id });
  if (!removed.deletedCount) return { following: false }; // nothing to undo

  const [updated] = await Promise.all([
    User.findByIdAndUpdate(target._id, { $inc: { followersCount: -1 } }, { returnDocument: "after" }).select("followersCount"),
    User.updateOne({ _id: user._id }, { $inc: { followingCount: -1 } }),
  ]);
  return { following: false, followersCount: updated.followersCount };
};

const listPeople = async ({ identifier, viewerId, query, direction }) => {
  const target = await resolveUser(identifier);
  const isSelf = Boolean(viewerId) && String(target._id) === String(viewerId);

  const prefs = await UserPreference.findOne({ user: target._id }).select("privacy.profileVisibility").lean();
  if (prefs?.privacy?.profileVisibility === "private" && !isSelf) {
    throw ApiError.forbidden("This profile is private", "PROFILE_PRIVATE");
  }

  const { page, limit, skip } = getPagination(query, 20, 50);
  const inactive = await getInactiveUserIds();
  const [anchor, other] = direction === "followers" ? ["following", "follower"] : ["follower", "following"];
  const filter = { [anchor]: target._id, [other]: { $nin: inactive } };

  const [rows, total] = await Promise.all([
    Follow.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).populate(other, CARD_SELECT).lean(),
    Follow.countDocuments(filter),
  ]);
  const people = rows.map((row) => row[other]).filter(Boolean);

  // which of these people does the viewer follow? (one query for the whole page)
  let followed = new Set();
  if (viewerId && people.length) {
    const edges = await Follow.find({ follower: viewerId, following: { $in: people.map((p) => p._id) } })
      .select("following")
      .lean();
    followed = new Set(edges.map((e) => String(e.following)));
  }

  const items = people.map((p) => ({
    ...toCard(p),
    isFollowing: followed.has(String(p._id)),
    isSelf: Boolean(viewerId) && String(p._id) === String(viewerId),
  }));
  return { items, meta: buildMeta(total, page, limit) };
};

export const listFollowers = (args) => listPeople({ ...args, direction: "followers" });
export const listFollowing = (args) => listPeople({ ...args, direction: "following" });