# Stage 1

## Scope and conventions

The platform supports these core actions:

- list a signed-in user's notifications, with unread filtering and cursor pagination;
- get one notification;
- mark one notification read or unread;
- mark all (or a selected set) as read;
- delete/dismiss a notification;
- receive new notifications and state changes in real time;
- create notifications through an internal, service-authenticated endpoint.

All public endpoints use `/api/v1`, HTTPS, UTF-8 JSON, plural resource names, camelCase JSON, ISO-8601 UTC timestamps, opaque IDs, and bearer authentication. The server derives the user ID from the access token; a client cannot select another user's notifications.

Common request headers:

```http
Authorization: Bearer <access-token>
Accept: application/json
Content-Type: application/json        # requests with a JSON body only
X-Request-Id: <uuid>                  # optional; generated if absent
Idempotency-Key: <uuid>               # required for internal create
```

Common response headers:

```http
Content-Type: application/json; charset=utf-8
X-Request-Id: <uuid>
Cache-Control: private, no-store
```

Errors have one predictable envelope:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "The request is invalid.",
    "details": [{ "field": "limit", "reason": "must be between 1 and 100" }],
    "requestId": "01J..."
  }
}
```

Expected status codes are `200`, `201`, `204`, `400`, `401`, `403`, `404`, `409`, `429`, and `500`. A resource belonging to another user returns `404`, avoiding resource enumeration.

## Resource contract

Example notification:

```json
{
  "id": "01JQ9Y7H8V8K2K6W6S83Y2AQRF",
  "type": "assignment.published",
  "title": "New assignment",
  "message": "Database Design is due Friday.",
  "data": { "courseId": "c_123", "assignmentId": "a_456" },
  "actionUrl": "/courses/c_123/assignments/a_456",
  "priority": "normal",
  "isRead": false,
  "readAt": null,
  "createdAt": "2026-07-01T07:30:00.000Z",
  "expiresAt": null
}
```

Essential JSON Schema (Draft 2020-12):

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://example.edu/schemas/notification.json",
  "type": "object",
  "additionalProperties": false,
  "required": ["id", "type", "title", "message", "data", "priority", "isRead", "readAt", "createdAt", "expiresAt"],
  "properties": {
    "id": { "type": "string", "minLength": 1, "maxLength": 64 },
    "type": { "type": "string", "pattern": "^[a-z][a-z0-9]*(\\.[a-z][a-z0-9]*)+$", "maxLength": 100 },
    "title": { "type": "string", "minLength": 1, "maxLength": 200 },
    "message": { "type": "string", "minLength": 1, "maxLength": 2000 },
    "data": { "type": "object", "maxProperties": 30 },
    "actionUrl": { "type": ["string", "null"], "maxLength": 2048 },
    "priority": { "enum": ["low", "normal", "high"] },
    "isRead": { "type": "boolean" },
    "readAt": { "type": ["string", "null"], "format": "date-time" },
    "createdAt": { "type": "string", "format": "date-time" },
    "expiresAt": { "type": ["string", "null"], "format": "date-time" }
  }
}
```

The internal create body omits server-owned fields and requires `studentId`, `type`, `title`, and `message`. It accepts optional `data`, `actionUrl`, `priority`, and `expiresAt`; unknown properties are rejected.

## REST endpoints

### List notifications

```http
GET /api/v1/notifications?status=unread&limit=20&cursor=<opaque-cursor>
```

`status` is `all|read|unread` (default `all`), and `limit` is 1–100 (default 20). The cursor encodes the last `(createdAt,id)` pair and must be treated as opaque.

```json
{
  "items": [{ "id": "01J...", "type": "assignment.published", "title": "New assignment", "message": "Database Design is due Friday.", "data": {}, "actionUrl": null, "priority": "normal", "isRead": false, "readAt": null, "createdAt": "2026-07-01T07:30:00.000Z", "expiresAt": null }],
  "page": { "nextCursor": "eyJjcmVhdGVkQXQiOiIuLi4iLCJpZCI6Ii4uLiJ9", "hasMore": true },
  "unreadCount": 12
}
```

Returns `200`.

### Get one notification

```http
GET /api/v1/notifications/{notificationId}
```

Returns `200` with `{ "notification": { ... } }`, or `404`.

### Change read state

```http
PATCH /api/v1/notifications/{notificationId}
Content-Type: application/json

{ "isRead": true }
```

Returns `200` with the updated notification. Repeating the same request is safe. `readAt` is set on the first transition to read and cleared when changed to unread.

### Mark many as read

```http
POST /api/v1/notifications/read
Content-Type: application/json

{ "all": true }
```

Alternatively: `{ "notificationIds": ["01J...", "01K..."] }`. Exactly one option is required; IDs not owned by the caller are ignored. Returns:

```json
{ "updatedCount": 23, "unreadCount": 0 }
```

### Delete/dismiss

```http
DELETE /api/v1/notifications/{notificationId}
```

Returns `204`; deletion is idempotent from the user's perspective.

### Create (internal services only)

```http
POST /internal/v1/notifications
Authorization: Bearer <service-token>
Idempotency-Key: 768dc...
Content-Type: application/json

{
  "studentId": 1042,
  "type": "assignment.published",
  "title": "New assignment",
  "message": "Database Design is due Friday.",
  "data": { "courseId": "c_123", "assignmentId": "a_456" },
  "actionUrl": "/courses/c_123/assignments/a_456",
  "priority": "normal",
  "expiresAt": null
}
```

Returns `201` with `{ "notification": { ... } }`. Reusing an idempotency key with the same body returns the original result; using it with a different body returns `409`.

## Real-time delivery

Use authenticated Server-Sent Events (SSE) because notification traffic is predominantly server-to-client, SSE reconnects natively, and it works over ordinary HTTP infrastructure:

```http
GET /api/v1/notifications/stream
Accept: text/event-stream
Authorization: Bearer <access-token>
Last-Event-ID: 01JQ...
```

```text
id: 01JQ9Z...
event: notification.created
data: {"notification":{"id":"01J...","type":"assignment.published"}}

event: notification.unread-count
data: {"unreadCount":13}
```

Mutation events are written to an outbox in the same database transaction as the notification change. A worker publishes them to a broker (for example, Redis Streams or Kafka), and each API instance forwards only the authenticated user's events. Heartbeats are sent every 15–30 seconds. On reconnect, `Last-Event-ID` enables bounded replay; if replay is unavailable, the server emits `notification.resync`, prompting the client to call the list endpoint. The REST API remains the source of truth—real-time delivery is an optimization, not a correctness dependency.

## Logging middleware

The middleware logs one structured record after the response finishes. It never logs bearer tokens, cookies, full bodies, or notification message/data, which may contain personal information.

```ts
import type { Request, Response, NextFunction } from "express";
import { randomUUID } from "node:crypto";

export function requestLogger(logger: { info: (o: object) => void }) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const requestId = String(req.header("x-request-id") || randomUUID());
    const started = process.hrtime.bigint();
    res.setHeader("X-Request-Id", requestId);

    res.on("finish", () => {
      logger.info({
        event: "http.request.completed",
        requestId,
        method: req.method,
        route: req.route?.path ?? req.path, // template preferred; avoid query/PII
        statusCode: res.statusCode,
        durationMs: Number(process.hrtime.bigint() - started) / 1e6,
        responseBytes: Number(res.getHeader("content-length")) || undefined,
        userId: res.locals.user?.id,          // populated by auth; hash if required
        userAgent: req.header("user-agent")
      });
    });

    next();
  };
}
```

Authentication should run before this middleware if `userId` is needed. Add centralized error logging with the same `requestId`, redact secrets recursively, restrict log access/retention, and export latency, request-rate, and 5xx metrics without high-cardinality IDs.

# Stage 2

## Storage choice

Use PostgreSQL. The data has clear relationships (student → notifications), benefits from foreign keys and atomic state changes, and must reliably coordinate notification rows with the delivery outbox. PostgreSQL also provides JSONB for type-specific payloads, partial/composite indexes, mature replication, and table partitioning. A document database is possible, but it does not remove the need for per-user indexes, idempotency, ordering, and reliable event publication.

## Schema

```sql
CREATE TYPE notification_priority AS ENUM ('low', 'normal', 'high');

CREATE TABLE notifications (
    id              uuid PRIMARY KEY,
    student_id      bigint NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    type            varchar(100) NOT NULL,
    title           varchar(200) NOT NULL,
    message         varchar(2000) NOT NULL,
    data            jsonb NOT NULL DEFAULT '{}'::jsonb,
    action_url      varchar(2048),
    priority        notification_priority NOT NULL DEFAULT 'normal',
    is_read         boolean NOT NULL DEFAULT false,
    read_at         timestamptz,
    created_at      timestamptz NOT NULL DEFAULT now(),
    expires_at      timestamptz,
    idempotency_key uuid,
    CHECK ((is_read AND read_at IS NOT NULL) OR (NOT is_read AND read_at IS NULL)),
    UNIQUE (student_id, idempotency_key)
);

CREATE INDEX notifications_student_feed_idx
    ON notifications (student_id, created_at DESC, id DESC);

CREATE INDEX notifications_student_unread_idx
    ON notifications (student_id, created_at DESC, id DESC)
    WHERE is_read = false;

CREATE TABLE notification_outbox (
    id              uuid PRIMARY KEY,
    notification_id uuid NOT NULL,
    student_id      bigint NOT NULL,
    event_type      varchar(100) NOT NULL,
    payload         jsonb NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now(),
    published_at    timestamptz
);

CREATE INDEX notification_outbox_pending_idx
    ON notification_outbox (created_at)
    WHERE published_at IS NULL;
```

At very large scale, range-partition `notifications` by `created_at` (for example monthly), retain only the product's required history, and archive older rows. Do not partition prematurely: it adds operational complexity and does not replace correct indexes.

## Queries mapped to the API

List the first unread page (use `is_read = $2` only when a status filter is supplied):

```sql
SELECT id, type, title, message, data, action_url, priority,
       is_read, read_at, created_at, expires_at
FROM notifications
WHERE student_id = $1
  AND is_read = false
  AND (expires_at IS NULL OR expires_at > now())
ORDER BY created_at DESC, id DESC
LIMIT $2;
```

Subsequent keyset page:

```sql
SELECT id, type, title, message, data, action_url, priority,
       is_read, read_at, created_at, expires_at
FROM notifications
WHERE student_id = $1
  AND is_read = false
  AND (created_at, id) < ($2::timestamptz, $3::uuid)
  AND (expires_at IS NULL OR expires_at > now())
ORDER BY created_at DESC, id DESC
LIMIT $4;
```

Fetch one securely:

```sql
SELECT * FROM notifications WHERE id = $1 AND student_id = $2;
```

Mark one read and return it:

```sql
UPDATE notifications
SET is_read = true, read_at = COALESCE(read_at, now())
WHERE id = $1 AND student_id = $2
RETURNING *;
```

Mark all read:

```sql
UPDATE notifications
SET is_read = true, read_at = now()
WHERE student_id = $1 AND is_read = false;
```

Delete one:

```sql
DELETE FROM notifications WHERE id = $1 AND student_id = $2;
```

Create reliably (inside one transaction):

```sql
BEGIN;
INSERT INTO notifications
    (id, student_id, type, title, message, data, action_url, priority,
     expires_at, idempotency_key)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
ON CONFLICT (student_id, idempotency_key) DO NOTHING
RETURNING *;

INSERT INTO notification_outbox
    (id, notification_id, student_id, event_type, payload)
VALUES ($11,$1,$2,'notification.created',$12);
COMMIT;
```

The application inserts the outbox row only when the notification insert succeeds; on an idempotency conflict it reads and returns the existing row.

## Growth risks and remedies

- **Slow scans and sorts:** use the feed and partial unread indexes, keyset pagination, bounded limits, and inspect plans with `EXPLAIN (ANALYZE, BUFFERS)`.
- **Unbounded table/index size:** enforce retention, archive history, delete expired notifications in small batches, and consider time partitions.
- **Write amplification:** keep indexes limited to demonstrated access patterns; batch fan-out and outbox processing.
- **Hot users or fan-out spikes:** queue creation work, apply per-tenant quotas/backpressure, and shard by `student_id` only after a single primary plus replicas is insufficient.
- **Read pressure:** use read replicas for feeds when slight lag is acceptable; route read-after-write requests to the primary. Cache short-lived unread counts, invalidated by events.
- **Dead rows from updates:** monitor autovacuum and table/index bloat; tune vacuum settings and batch bulk updates.
- **Lost/duplicate real-time events:** use the transactional outbox and at-least-once consumers; event IDs and idempotent clients make duplicates harmless.
- **Operational safety:** collect p95/p99 latency, index hit rate, locks, replication lag, outbox age, and queue depth; test restores, not only backups.

# Stage 3

The query is slow because five million rows make a sequential scan plus sort expensive. Its predicates and ordering require one compound access path; separate indexes on `studentId`, `isRead`, or `createdAt` are usually inferior. It also has no `LIMIT`, so a student with many unread notifications can still force a large result transfer.

For the query exactly as written, add a partial covering-order index:

```sql
CREATE INDEX CONCURRENTLY notifications_unread_feed_idx
ON notifications (student_id, created_at DESC, id DESC)
WHERE is_read = false;
```

Then use a bounded, deterministic first-page query:

```sql
SELECT id, type, title, message, data, action_url, priority,
       is_read, read_at, created_at, expires_at
FROM notifications
WHERE student_id = 1042
  AND is_read = false
ORDER BY created_at DESC, id DESC
LIMIT 20;
```

Use the Stage 2 keyset query for later pages; do not use large `OFFSET`s. Selecting named columns avoids unnecessary I/O, while the added `id` tie-breaker prevents duplicates or gaps when timestamps match.

Verify rather than assume:

```sql
ANALYZE notifications;
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, type, title, message, created_at
FROM notifications
WHERE student_id = 1042 AND is_read = false
ORDER BY created_at DESC, id DESC
LIMIT 20;
```

The desired plan is an index scan using `notifications_unread_feed_idx`, already in the requested order, with no full-table scan or explicit sort. Build with `CONCURRENTLY` in production to avoid blocking normal writes (it takes longer and cannot run inside a transaction). If the actual schema uses quoted camelCase identifiers, quote them consistently; preferably migrate to unquoted snake_case. Finally, confirm tenant data distribution, index usage, bloat, and statistics before considering partitioning or replicas—the index and pagination are the direct fix for this access pattern.

## Correctness and computational cost

The original query is logically correct only if the physical column names and boolean syntax match the selected database. PostgreSQL folds unquoted camelCase names to lowercase, so quoted legacy names such as `"studentID"` would require quotes. The query is unsuitable for a feed because `SELECT *` fetches unnecessary data, the order is nondeterministic when timestamps tie, expired notifications are not excluded, and the missing `LIMIT` can return every unread row.

Without a useful index, the database scans `N` rows and may sort `M` matches: approximately `O(N + M log M)` time. With the partial compound index and a page size `K`, access is approximately `O(log U + K)`, where `U` is the unread index size. The tradeoff is `O(U)` index storage and roughly `O(log U)` extra work when an unread row is inserted or changes state.

Adding an index to every column is not effective. It consumes disk and cache, slows inserts/updates/deletes, increases vacuum/maintenance work, and single-column indexes often cannot satisfy a multi-column filter and ordering. The boolean `is_read` is especially low-selectivity by itself. Indexes should be derived from measured query patterns and validated with query plans.

Students who received a placement notification in the last seven days:

```sql
SELECT DISTINCT student_id
FROM notifications
WHERE type = 'Placement'
  AND created_at >= now() - INTERVAL '7 days';
```

For the legacy names in the question, use `"studentID"`, `"notificationType"`, and `"createdAt"` consistently. If this becomes a frequent report, support it with `(type, created_at DESC, student_id)`; do not add that index until the workload justifies its write and storage cost.

# Stage 4

Fetching every notification on every page load multiplies database work by page views, repeats unchanged data transfer, increases latency, and produces visible loading or failures during traffic spikes. The recommended design is a cached, paginated initial read followed by incremental real-time updates:

1. On first load, request only the newest 20 notifications using keyset pagination. Return an `ETag` and a separately maintained unread count.
2. Keep the response in a short-lived per-user cache (for example Redis) and in the browser. Subsequent page loads use `If-None-Match`; unchanged data returns `304` with no body.
3. After the initial page, use the Stage 1 SSE stream for new/updated notifications instead of repeatedly querying the database. Reconnect with `Last-Event-ID`; resync through REST if the replay window is missed.
4. Invalidate or update the cache after a write through the transactional outbox. Serve replica-safe feed reads from a read replica when slight lag is acceptable, while read-after-write requests use the primary.
5. Retain bounded history and load older pages only when the student asks for them.

Tradeoffs:

- **Browser/Redis caching** gives the largest reduction in repeated reads, but introduces invalidation and short-lived staleness. TTLs plus event-driven invalidation bound that risk.
- **SSE** provides low-latency updates and excellent UX, but consumes long-lived connections and requires reconnect/replay handling.
- **Read replicas** increase read capacity, but cost more and can lag.
- **Pagination alone** is simple and bounds each query, but still repeats the first-page read on every page load.
- **Precomputed unread counts** make badges cheap, but must be updated atomically or periodically reconciled.

This hybrid keeps REST and PostgreSQL as the source of truth while preventing both the database and the user interface from being overwhelmed.

# Stage 5

The sequential loop has several failure modes: it takes 50,000 times the latency of each downstream call; one failure can stop the entire campaign; retries can duplicate email, rows, or pushes; there is no durable progress; it may overload the email and push providers; and external calls are held inside an application loop with no backpressure.

Saving a notification and sending its email should **not** be one distributed transaction. A database cannot atomically roll back an email already accepted by a provider. Instead, atomically save notification rows and durable outbox jobs, commit, and let independent workers deliver email and push at a safe rate.

```text
notify_all(student_ids, message, campaign_id):
  validate request and claim unique campaign_id
  for each chunk of 500 students:
    begin transaction
      bulk insert notifications (unique campaign_id, student_id)
      bulk insert email_outbox jobs referencing those notifications
      bulk insert push_outbox jobs referencing those notifications
    commit
  return 202 Accepted with campaign_id

email_worker:
  claim a bounded batch using FOR UPDATE SKIP LOCKED
  send concurrently with a provider rate/concurrency limit
  on success: store provider_message_id and delivered_at
  on transient failure: retry with exponential backoff and jitter
  after retry limit: move to dead-letter state and alert
```

Each job has a unique key such as `(campaign_id, student_id, channel)`, making retries idempotent. Workers acknowledge only after recording success. If email fails for 200 students midway, successful deliveries remain successful; only failed/pending jobs are retried. The in-app notification is already durable and the push channel proceeds independently. A campaign status endpoint reports total, pending, delivered, and failed counts, and an operator can replay dead-letter jobs after correcting the cause.

This architecture is fast because inserts are batched and delivery is parallel but bounded. It is reliable because work is durable, resumable, observable, rate-limited, and idempotent. Queue depth, oldest-job age, delivery latency, retry counts, provider errors, and dead-letter counts should be monitored.

# Stage 6

## Priority rule

Importance is a lexicographic combination:

1. notification type weight: `Placement = 3`, `Result = 2`, `Event = 1`;
2. within the same type, the newest valid `Timestamp` wins;
3. notification ID is a deterministic final tie-breaker.

This interpretation preserves the product manager's explicit type order while using recency to order equal-type notifications. The API accepts `?limit=N` so users may request top 10, 15, or 20 (bounded by configured capacity).

## Implementation and ongoing updates

The functioning Node.js implementation is in `notification-app-be`. It:

- fetches the supplied protected notification API without storing notifications in a database;
- reads the authorization value from `NOTIFICATION_API_AUTHORIZATION`, so credentials are never committed;
- validates and normalizes the API's `ID`, `Type`, `Message`, and `Timestamp` fields;
- polls for new notifications every 15 seconds and deduplicates them by ID;
- maintains only the highest-priority `K` items in a bounded min-heap;
- serves a browser view at `/` and JSON at `/notifications/top?limit=10`.

For each unseen notification, heap maintenance costs `O(log K)` time; returning the display costs `O(K log K)` to sort the small heap. Heap memory is `O(K)`. The deduplication ID set must be expired according to the source retention window in a long-running production system. A true push/stream source could call the same `add` operation and remove polling without changing the ranking structure.

The source endpoint currently responds with `401` when no authorization header is supplied, so the application supports the protected route exactly as observed. Run it with the complete header value issued by the assessment system, then capture the top-notifications page for the required output screenshot. Unit tests verify weighting, recency, bounded top-K behavior, duplicate handling, and API-field normalization.
