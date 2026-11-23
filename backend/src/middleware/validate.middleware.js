import { ApiError } from "../utils/ApiError.js";

// schema = z.object({ body, query, params }) (any can be omitted)
export const validate = (schema) => (req, res, next) => {
  const result = schema.safeParse({
    body: req.body,
    query: req.query,
    params: req.params,
  });

  if (!result.success) {
    const details = result.error.issues.map((i) => ({
      field: i.path.slice(1).join("."),
      message: i.message,
    }));
    return next(new ApiError(422, "Validation failed", details));
  }

  if (result.data.body) req.body = result.data.body;
  req.validated = result.data; // use req.validated.query / .params in controllers
  next();
};