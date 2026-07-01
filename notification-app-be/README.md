# Notification Priority Service

Stage 6 implementation that fetches the protected assessment API and maintains
the top `K` notifications in a bounded min-heap. Type weight is the primary key
(`Placement > Result > Event`) and timestamp is the recency tie-breaker.

## Run

Requires Node.js 18 or newer. The assessment API currently requires an
`Authorization` header. Set the complete value provided by the assessment
system; do not commit credentials.

PowerShell:

```powershell
$env:NOTIFICATION_API_AUTHORIZATION = "Bearer <access-token>"
npm start
```

Open `http://localhost:3000/?limit=10`. JSON is available at
`http://localhost:3000/notifications/top?limit=10`.

Configuration:

- `NOTIFICATION_API_URL`: source URL (defaults to the assessment URL)
- `NOTIFICATION_API_AUTHORIZATION`: complete authorization header value
- `POLL_INTERVAL_MS`: refresh interval, default 15 seconds
- `TOP_K_CAPACITY`: maximum selectable top-N, default 20
- `PORT`: local HTTP port, default 3000

Run `npm test` to verify ranking, bounded storage, deduplication, and response
normalization. No third-party dependencies are required.

## Complexity

Each unseen notification is processed in `O(log K)` time. Memory for the heap is
`O(K)`; IDs are remembered to avoid reprocessing repeated polling responses. A
production stream with unbounded IDs should expire or persist the deduplication
set using the source system's retention window.
