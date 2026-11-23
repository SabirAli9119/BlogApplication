export class ApiError extends Error {
  constructor(statusCode, message, details = null, code = null) {
    super(message);
    this.statusCode = statusCode;
    this.details = details;
    this.code = code; // machine-readable, e.g. TOKEN_EXPIRED
  }

  static badRequest(msg = "Bad request", details) { return new ApiError(400, msg, details); }
  static unauthorized(msg = "Unauthorized", code) { return new ApiError(401, msg, null, code); }
  static forbidden(msg = "Forbidden", code) { return new ApiError(403, msg, null, code); }
  static notFound(msg = "Not found") { return new ApiError(404, msg); }
  static conflict(msg = "Conflict") { return new ApiError(409, msg); }
  static tooMany(msg = "Too many requests") { return new ApiError(429, msg); }
}