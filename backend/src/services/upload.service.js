import fs from "fs/promises";
import path from "path";
import crypto from "crypto";
import cloudinary, { isCloudinaryConfigured } from "../config/cloudinary.js";
import { env } from "../config/env.js";
import { ApiError } from "../utils/ApiError.js";

// The browser-reported MIME type can be faked, so we check the real file signature too.
const detectImageType = (buf) => {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpg";
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (buf.subarray(0, 4).toString("ascii") === "RIFF" && buf.subarray(8, 12).toString("ascii") === "WEBP") return "webp";
  return null;
};

export const uploadImage = async (file, folder = "blogify/covers") => {
  const type = detectImageType(file.buffer);
  if (!type) throw ApiError.badRequest("File is not a valid JPG, PNG or WEBP image");

  if (isCloudinaryConfigured()) {
    const result = await new Promise((resolve, reject) => {
      cloudinary.uploader
        .upload_stream({ folder, resource_type: "image" }, (err, res) => (err ? reject(err) : resolve(res)))
        .end(file.buffer);
    });
    return { url: result.secure_url, publicId: result.public_id };
  }

  if (env.isProd) throw new Error("Cloudinary must be configured in production");

  // development fallback: save to local disk
  const name = `${crypto.randomUUID()}.${type}`;
  await fs.mkdir(path.resolve(env.uploadDir), { recursive: true });
  await fs.writeFile(path.resolve(env.uploadDir, name), file.buffer);
  return { url: `${env.serverUrl}/uploads/${name}`, publicId: `local:${name}` };
};

export const deleteImage = async (publicId) => {
  if (!publicId) return;
  try {
    if (publicId.startsWith("local:")) {
      await fs.unlink(path.resolve(env.uploadDir, path.basename(publicId.slice(6))));
    } else {
      await cloudinary.uploader.destroy(publicId);
    }
  } catch (err) {
    console.error("Failed to delete image:", err.message);
  }
};