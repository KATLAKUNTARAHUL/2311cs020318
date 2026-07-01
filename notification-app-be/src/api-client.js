function normalizeNotification(raw) {
  const notification = {
    id: String(raw.ID ?? raw.id ?? ""),
    type: String(raw.Type ?? raw.type ?? ""),
    message: String(raw.Message ?? raw.message ?? ""),
    timestamp: String(raw.Timestamp ?? raw.timestamp ?? "")
  };

  if (!notification.id || !notification.type || !notification.timestamp) {
    throw new TypeError("notification is missing ID, Type, or Timestamp");
  }
  if (!Number.isFinite(Date.parse(notification.timestamp))) {
    throw new TypeError(`notification ${notification.id} has an invalid Timestamp`);
  }
  return notification;
}

async function fetchNotifications({ url, authorization, fetchImpl = fetch }) {
  const headers = { Accept: "application/json" };
  if (authorization) headers.Authorization = authorization;

  const response = await fetchImpl(url, { headers, signal: AbortSignal.timeout(10_000) });
  if (!response.ok) {
    throw new Error(`notification API returned ${response.status}`);
  }

  const body = await response.json();
  if (!Array.isArray(body.notifications)) {
    throw new TypeError("notification API response must contain a notifications array");
  }

  const valid = [];
  for (const raw of body.notifications) {
    try {
      valid.push(normalizeNotification(raw));
    } catch (error) {
      console.warn("Ignoring malformed notification:", error.message);
    }
  }
  return valid;
}

module.exports = { normalizeNotification, fetchNotifications };
