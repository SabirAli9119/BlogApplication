import dotenv from "dotenv";
dotenv.config();

const required = ["MONGO_URI", "JWT_ACCESS_SECRET", "JWT_REFRESH_SECRET"];
for (const key of required) {
  if (!process.env[key]) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
}

const isProd = process.env.NODE_ENV === "production";
const port = Number(process.env.PORT) || 5000;

if (isProd && process.env.JWT_ACCESS_SECRET.startsWith("change_me")) {
  throw new Error("Set real JWT secrets before running in production");
}

export const env = {
  nodeEnv: process.env.NODE_ENV || "development",
  isProd,
  port,
  clientUrl: process.env.CLIENT_URL || "http://localhost:5173",
  serverUrl: process.env.SERVER_URL || `http://localhost:${port}`,
  mongoUri: process.env.MONGO_URI,
  bcryptRounds: Number(process.env.BCRYPT_ROUNDS) || 12,
  cookieDomain: process.env.COOKIE_DOMAIN || undefined,
  uploadDir: process.env.UPLOAD_DIR || "uploads",
  requireEmailVerification: process.env.REQUIRE_EMAIL_VERIFICATION
    ? process.env.REQUIRE_EMAIL_VERIFICATION === "true"
    : isProd,
  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET,
    refreshSecret: process.env.JWT_REFRESH_SECRET,
    accessExpires: process.env.JWT_ACCESS_EXPIRES || "15m",
    refreshExpires: process.env.JWT_REFRESH_EXPIRES || "7d",
  },
  cloudinary: {
    cloudName: process.env.CLOUDINARY_CLOUD_NAME,
    apiKey: process.env.CLOUDINARY_API_KEY,
    apiSecret: process.env.CLOUDINARY_API_SECRET,
  },
  smtp: {
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 587,
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
    from: process.env.SMTP_FROM || "Blogify <no-reply@blogify.local>",
  },
  retention: {
    activityDays: Number(process.env.ACTIVITY_RETENTION_DAYS) || 180,
    loginHistoryDays: Number(process.env.LOGIN_HISTORY_RETENTION_DAYS) || 365,
    locationDays: Number(process.env.LOCATION_RETENTION_DAYS) || 90,
    notificationDays: Number(process.env.NOTIFICATION_RETENTION_DAYS) || 90,
  },
};