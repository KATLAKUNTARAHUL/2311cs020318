const http = require("node:http");
const { fetchNotifications } = require("./api-client");
const { TopKNotifications, TYPE_WEIGHT } = require("./top-k");

const PORT = Number(process.env.PORT || 3000);
const API_URL = process.env.NOTIFICATION_API_URL
  || "http://4.224.186.213/evaluation-service/notifications";
const AUTHORIZATION = process.env.NOTIFICATION_API_AUTHORIZATION;
const POLL_INTERVAL_MS = Math.max(Number(process.env.POLL_INTERVAL_MS) || 15_000, 1_000);
const CAPACITY = Math.max(Number(process.env.TOP_K_CAPACITY) || 20, 1);

const ranking = new TopKNotifications(CAPACITY);
let lastSyncedAt = null;
let lastError = null;

async function syncNotifications() {
  try {
    const notifications = await fetchNotifications({ url: API_URL, authorization: AUTHORIZATION });
    ranking.addMany(notifications);
    lastSyncedAt = new Date().toISOString();
    lastError = null;
  } catch (error) {
    lastError = error.message;
    console.error("Notification sync failed:", error.message);
  }
}

function json(res, statusCode, body) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(body, null, 2));
}

function page(limit) {
  const cards = ranking.top(limit).map((item, index) => `
    <article class="card">
      <span class="rank">#${index + 1}</span>
      <span class="type ${item.type.toLowerCase()}">${escapeHtml(item.type)}</span>
      <h2>${escapeHtml(item.message)}</h2>
      <time>${escapeHtml(item.timestamp)}</time>
    </article>`).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
  <title>Priority Notifications</title><style>
  body{font-family:system-ui,sans-serif;background:#f4f7fb;color:#162033;margin:0;padding:36px}main{max-width:900px;margin:auto}
  header{display:flex;justify-content:space-between;align-items:end;margin-bottom:24px}h1{margin:0;font-size:32px}.meta{color:#667085}
  .card{position:relative;background:white;border:1px solid #dce3ee;border-radius:14px;padding:20px 24px;margin:12px 0;box-shadow:0 4px 14px #172b4d0c}
  .rank{position:absolute;right:20px;color:#98a2b3;font-weight:700}.type{display:inline-block;padding:4px 10px;border-radius:99px;font-size:12px;font-weight:800;text-transform:uppercase}
  .placement{background:#dcfae6;color:#087443}.result{background:#e0eaff;color:#2846a5}.event{background:#fff2cc;color:#805b00}
  h2{font-size:18px;margin:12px 0 6px}time{color:#667085;font-size:13px}.error{background:#fff0f0;color:#a00;padding:12px;border-radius:8px}
  </style></head><body><main><header><div><h1>Priority Notifications</h1><div class="meta">Placement &gt; Result &gt; Event; newest first within each type</div></div><strong>Top ${limit}</strong></header>
  ${lastError ? `<p class="error">Last sync: ${escapeHtml(lastError)}</p>` : ""}${cards || "<p>No notifications have been loaded.</p>"}
  </main></body></html>`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;"
  })[character]);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 10, 1), CAPACITY);

  if (req.method === "GET" && url.pathname === "/health") {
    return json(res, lastError ? 503 : 200, { ok: !lastError, lastSyncedAt, lastError });
  }
  if (req.method === "GET" && url.pathname === "/notifications/top") {
    return json(res, 200, {
      ranking: { typeWeight: TYPE_WEIGHT, tieBreaker: "newest timestamp first" },
      count: ranking.top(limit).length,
      lastSyncedAt,
      notifications: ranking.top(limit)
    });
  }
  if (req.method === "GET" && url.pathname === "/") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    return res.end(page(limit));
  }
  return json(res, 404, { error: "Not found" });
});

if (require.main === module) {
  server.listen(PORT, () => console.log(`Notification service listening on http://localhost:${PORT}`));
  syncNotifications();
  const timer = setInterval(syncNotifications, POLL_INTERVAL_MS);
  timer.unref();
}

module.exports = { server, syncNotifications };
