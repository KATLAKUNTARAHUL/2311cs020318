# Logging Middleware

An Express-compatible middleware that emits one structured record when each
HTTP response finishes. It propagates `X-Request-Id`, records latency and status,
and intentionally excludes authorization headers, cookies, request bodies, and
query strings.

## Usage

```js
const express = require("express");
const { createRequestLogger } = require("./src/request-logger");

const app = express();
app.use(createRequestLogger(console));
```

Run the dependency-free tests with `npm test`.

In production, pass a JSON logger such as Pino or Winston. Apply authentication
first if the record should include `res.locals.user.id`.
