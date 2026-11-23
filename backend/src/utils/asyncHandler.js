// Express 5 already forwards async errors, but this keeps controllers explicit.
export const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);