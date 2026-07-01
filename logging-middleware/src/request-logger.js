const { randomUUID } = require("node:crypto");

/** Create Express-compatible structured request logging middleware. */
function createRequestLogger(logger = console) {
  if (!logger || typeof logger.info !== "function") {
    throw new TypeError("logger must provide an info(record) function");
  }

  return function requestLogger(req, res, next) {
    const requestId = req.get?.("x-request-id") || randomUUID();
    const startedAt = process.hrtime.bigint();
    res.setHeader("X-Request-Id", requestId);

    res.once("finish", () => {
      const contentLength = Number(res.getHeader("content-length"));
      logger.info({
        event: "http.request.completed",
        requestId,
        method: req.method,
        route: req.route?.path || req.path || req.url?.split("?", 1)[0],
        statusCode: res.statusCode,
        durationMs: Number(process.hrtime.bigint() - startedAt) / 1e6,
        responseBytes: Number.isFinite(contentLength) && contentLength > 0
          ? contentLength
          : undefined,
        userId: res.locals?.user?.id,
        userAgent: req.get?.("user-agent")
      });
    });

    next();
  };
}

module.exports = { createRequestLogger };
