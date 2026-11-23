export const getPagination = (query, defaultLimit = 10, maxLimit = 50) => {
  const page = Math.max(parseInt(query.page) || 1, 1);
  const limit = Math.min(Math.max(parseInt(query.limit) || defaultLimit, 1), maxLimit);
  return { page, limit, skip: (page - 1) * limit };
};

export const buildMeta = (total, page, limit) => ({
  total,
  page,
  limit,
  totalPages: Math.ceil(total / limit),
  hasNext: page * limit < total,
  hasPrev: page > 1,
});