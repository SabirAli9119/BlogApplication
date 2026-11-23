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

app.set("trust proxy", 1); // correct client IPs behind a proxy/host (Render, etc.)
app.disable("x-powered-by");

app.use(helmet());
app.use(cors(corsOptions));
app.use(compression());
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));
app.use(cookieParser());
app.use(sanitizeInput);
if (env.nodeEnv === "development") app.use(morgan("dev"));

app.use("/api", apiLimiter);
app.use("/api", routes);

app.use(notFound);
app.use(errorHandler);

export default app;