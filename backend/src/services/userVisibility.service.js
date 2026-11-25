import { User } from "../models/index.js";
import { ACCOUNT_STATUS } from "../constants/roles.js";
import { ApiError } from "../utils/ApiError.js";

// Suspended, banned, deactivated and deleted accounts are invisible to everyone else.
export const getInactiveUserIds = () =>
  User.find({
    $or: [{ status: { $ne: ACCOUNT_STATUS.ACTIVE } }, { deletedAt: { $exists: true } }],
  }).distinct("_id");

const isObjectId = (value) => /^[a-f\d]{24}$/i.test(value);

// "identifier" is a user id or a username, so profile links can use either.
export const resolveUser = async (identifier, { activeOnly = true } = {}) => {
  const filter = isObjectId(identifier) ? { _id: identifier } : { username: identifier.toLowerCase() };
  const user = await User.findOne({ ...filter, deletedAt: { $exists: false } })
    .select(
      "username firstName lastName avatar coverPicture headline bio contact isVerifiedBadge " +
        "followersCount followingCount lastLoginAt createdAt status"
    )
    .lean();
  if (!user || (activeOnly && user.status !== ACCOUNT_STATUS.ACTIVE)) throw ApiError.notFound("User not found");
  return user;
};