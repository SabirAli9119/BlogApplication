import path from "path";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import compression from "compression";
import cookieParser from "cookie-parser";
import { env } from "./config/env.js";
import { corsOptions } from "./config/cors.js";
import routes from "./routes/index.js";
import { apiLimiter } from "./middleware/rateLimiter.middleware.js";
import { sanitizeInput } from "./middleware/sanitize.middleware.js";
import { notFound } from "./middleware/notFound.middleware.js";
import { errorHandler } from "./middleware/errorHandler.middleware.js";

const app = express();

app.set("trust proxy", 1);
app.disable("x-powered-by");

// cross-origin: the React app (another origin) must be able to show our images
app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
app.use(cors(corsOptions));
app.use(compression());
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));
app.use(cookieParser());
app.use(sanitizeInput);
if (env.nodeEnv === "development") app.use(morgan("dev"));

// local image fallback for development (production uses Cloudinary)
app.use("/uploads", express.static(path.resolve(env.uploadDir), { maxAge: "7d" }));

app.use("/api", apiLimiter);
app.use("/api", routes);

app.use(notFound);
app.use(errorHandler);

export default app;