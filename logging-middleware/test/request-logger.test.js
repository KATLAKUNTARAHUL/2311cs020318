const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { createRequestLogger } = require("../src/request-logger");

function makeResponse() {
  const res = new EventEmitter();
  const headers = new Map();
  res.statusCode = 200;
  res.locals = {};
  res.setHeader = (name, value) => headers.set(name.toLowerCase(), value);
  res.getHeader = (name) => headers.get(name.toLowerCase());
  return res;
}

test("logs a completed request", () => {
  const records = [];
  const middleware = createRequestLogger({ info: (record) => records.push(record) });
  const req = {
    method: "GET",
    path: "/api/v1/notifications",
    get: (name) => name === "user-agent" ? "test-agent" : undefined
  };
  const res = makeResponse();
  let nextCalled = false;

  middleware(req, res, () => { nextCalled = true; });
  res.emit("finish");

  assert.equal(nextCalled, true);
  assert.match(res.getHeader("x-request-id"), /^[0-9a-f-]{36}$/);
  assert.equal(records.length, 1);
  assert.equal(records[0].event, "http.request.completed");
  assert.equal(records[0].route, "/api/v1/notifications");
  assert.equal(records[0].statusCode, 200);
  assert.equal(records[0].userAgent, "test-agent");
  assert.equal(typeof records[0].durationMs, "number");
});

test("preserves a supplied request ID and uses the route template", () => {
  const records = [];
  const middleware = createRequestLogger({ info: (record) => records.push(record) });
  const req = {
    method: "PATCH",
    path: "/api/v1/notifications/n_1",
    route: { path: "/api/v1/notifications/:notificationId" },
    get: (name) => name === "x-request-id" ? "request-123" : undefined
  };
  const res = makeResponse();
  res.statusCode = 204;
  res.locals.user = { id: 1042 };

  middleware(req, res, () => {});
  res.emit("finish");

  assert.equal(res.getHeader("x-request-id"), "request-123");
  assert.equal(records[0].requestId, "request-123");
  assert.equal(records[0].route, "/api/v1/notifications/:notificationId");
  assert.equal(records[0].userId, 1042);
});

test("rejects an invalid logger", () => {
  assert.throws(() => createRequestLogger({}), /info/);
});
