import multer from "multer";
import { ApiError } from "../utils/ApiError.js";

const ALLOWED = ["image/jpeg", "image/png", "image/webp"];

export const uploadImageFile = (fieldName, maxMb = 5) =>
  multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxMb * 1024 * 1024, files: 1, fields: 20 },
    fileFilter: (req, file, cb) =>
      ALLOWED.includes(file.mimetype)
        ? cb(null, true)
        : cb(ApiError.badRequest("Only JPG, PNG or WEBP images are allowed")),
  }).single(fieldName);