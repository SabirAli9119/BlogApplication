import { Notification } from "../models/index.js";

export const createNotification = async ({ recipient, sender, type, message, resource }) => {
  try {
    return await Notification.create({ recipient, sender, type, message, resource });
  } catch (err) {
    console.error("Notification failed:", err.message);
    return null;
  }
};