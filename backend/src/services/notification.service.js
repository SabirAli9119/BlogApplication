import { Notification, UserPreference } from "../models/index.js";
import { NOTIFICATION_TYPES } from "../constants/eventTypes.js";

export const shorten = (text = "", max = 80) => (text.length > max ? `${text.slice(0, max)}…` : text);

// Which of the user's notification switches controls each type (security alerts are never optional).
const PREFERENCE_BY_TYPE = {
  [NOTIFICATION_TYPES.NEW_FOLLOWER]: "newFollower",
  [NOTIFICATION_TYPES.BLOG_LIKE]: "likes",
  [NOTIFICATION_TYPES.NEW_COMMENT]: "comments",
  [NOTIFICATION_TYPES.COMMENT_REPLY]: "comments",
  [NOTIFICATION_TYPES.MENTION]: "mentions",
  [NOTIFICATION_TYPES.ADMIN_ANNOUNCEMENT]: "announcements",
};

export const createNotification = async ({ recipient, sender, type, message, resource }) => {
  try {
    // return await Notification.create({ recipient, sender, type, message, resource });
    return await Notification.create({ recipient, sender, type, message: shorten(message, 300), resource });
  } catch (err) {
    console.error("Notification failed:", err.message);
    return null;
  }
};

// Never notifies you about your own action, respects the recipient's settings, and can skip repeats.
export const notifyIfAllowed = async ({ recipient, sender, type, message, resource, dedupe = false }) => {
  try {
    if (!recipient || (sender && String(recipient) === String(sender))) return null;

    const prefKey = PREFERENCE_BY_TYPE[type];
    if (prefKey) {
      const prefs = await UserPreference.findOne({ user: recipient }).select("notifications").lean();
      if (prefs?.notifications?.[prefKey] === false) return null;
    }

    if (dedupe) {
      const already = await Notification.exists({
        recipient,
        sender,
        type,
        "resource.kind": resource?.kind,
        "resource.id": resource?.id,
      });
      if (already) return null;
    }
    return await createNotification({ recipient, sender, type, message, resource });
  } catch (err) {
    console.error("Notify failed:", err.message);
    return null;
  }
};