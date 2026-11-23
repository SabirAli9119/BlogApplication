import mongoose from "mongoose";
import { env } from "./env.js";

mongoose.set("strictQuery", true);

export const connectDB = async () => {
  mongoose.connection.on("disconnected", () =>
    console.warn("MongoDB disconnected")
  );
  mongoose.connection.on("reconnected", () =>
    console.log("MongoDB reconnected")
  );
  mongoose.connection.on("error", (err) =>
    console.error("MongoDB error:", err.message)
  );

  await mongoose.connect(env.mongoUri, {
    serverSelectionTimeoutMS: 8000,
    maxPoolSize: 10,
  });

  console.log(`MongoDB connected: ${mongoose.connection.host}/${mongoose.connection.name}`);
};

export const disconnectDB = async () => {
  await mongoose.connection.close();
  console.log("MongoDB connection closed");
};