import { ActivityLog } from "../models/index.js";

// Logging problems must never break the real request.
export const logActivity = async ({ user, event, device, resourceType, resourceId, result = "success" }) => {
  try {
    await ActivityLog.create({
      user,
      event,
      result,
      resourceType,
      resourceId,
      ip: device?.ip,
      device: device
        ? { browser: device.browser, os: device.os, deviceType: device.deviceType }
        : undefined,
    });
  } catch (err) {
    console.error("Activity log failed:", err.message);
  }
};