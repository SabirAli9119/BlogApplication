import { env } from "./env.js";

export const corsOptions = {
  origin: (origin, callback) => {
    // allow tools like curl/Postman (no origin) and our frontend
    if (!origin || origin === env.clientUrl) return callback(null, true);
    callback(new Error("Not allowed by CORS"));
  },
  credentials: true, // needed for HTTP-only cookies
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
};