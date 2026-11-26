import { NOTIFICATION_TYPES } from "../constants/eventTypes.js";
import { createNotification } from "./notification.service.js";
import { sendModerationEmail } from "./email.service.js";

// In-app notification, plus an email when it matters. `user` needs _id, email and firstName.
export const notifyAndEmail = async (user, message, { type = NOTIFICATION_TYPES.MODERATION, email = true, resource } = {}) => {
  if (!user) return;
  await createNotification({ recipient: user._id, type, message, resource });
  if (email && user.email) await sendModerationEmail(user, message);
};