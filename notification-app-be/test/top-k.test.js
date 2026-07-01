const test = require("node:test");
const assert = require("node:assert/strict");
const { TopKNotifications } = require("../src/top-k");
const { normalizeNotification } = require("../src/api-client");

function notification(id, type, timestamp) {
  return { id, type, message: id, timestamp };
}

test("ranks type weight before recency and recency within a type", () => {
  const top = new TopKNotifications(10);
  top.addMany([
    notification("event-new", "Event", "2026-07-01T12:00:00Z"),
    notification("placement-old", "Placement", "2026-06-01T12:00:00Z"),
    notification("result", "Result", "2026-07-01T11:00:00Z"),
    notification("placement-new", "Placement", "2026-07-01T10:00:00Z")
  ]);

  assert.deepEqual(top.top(4).map((item) => item.id), [
    "placement-new", "placement-old", "result", "event-new"
  ]);
});

test("keeps only K highest-priority notifications and ignores duplicate IDs", () => {
  const top = new TopKNotifications(2);
  top.addMany([
    notification("event", "Event", "2026-07-01T12:00:00Z"),
    notification("result", "Result", "2026-07-01T11:00:00Z"),
    notification("placement", "Placement", "2026-07-01T10:00:00Z"),
    notification("placement", "Placement", "2026-07-01T13:00:00Z")
  ]);

  assert.deepEqual(top.top(10).map((item) => item.id), ["placement", "result"]);
});

test("normalizes the assessment API's capitalized fields", () => {
  assert.deepEqual(normalizeNotification({
    ID: "n-1", Type: "Placement", Message: "Placed", Timestamp: "2026-07-01T12:00:00Z"
  }), {
    id: "n-1", type: "Placement", message: "Placed", timestamp: "2026-07-01T12:00:00Z"
  });
});
