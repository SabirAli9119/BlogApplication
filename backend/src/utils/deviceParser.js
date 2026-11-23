import { UAParser } from "ua-parser-js";
import geoip from "geoip-lite";

export const getClientIp = (req) => req.ip || req.socket?.remoteAddress || "unknown";

export const getDeviceInfo = (req) => {
  const ua = new UAParser(req.headers["user-agent"] || "").getResult();
  const ip = getClientIp(req);
  const geo = geoip.lookup(ip); // approximate, derived from IP only

  return {
    browser: ua.browser.name || "Unknown",
    os: ua.os.name || "Unknown",
    deviceType: ua.device.type || "desktop",
    ip,
    approxLocation: geo ? { country: geo.country, city: geo.city || null } : null,
  };
};