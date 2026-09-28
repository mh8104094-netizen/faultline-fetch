# Faultline Fetch

A dependency-free HTTP client for Node.js 18+ and modern browsers. It retries temporary failures for safe HTTP methods, sets a request timeout, and opens a circuit after repeated failures.

## Why this exists

Network failures are normal. Retrying every request can duplicate writes, while retrying forever can make an outage worse. Faultline Fetch retries only GET, HEAD, and OPTIONS, and stops calling an unhealthy upstream until a recovery probe can run.

## Quick start

```js
import { createClient } from './index.js';

const api = createClient({ retries: 2, timeoutMs: 4000 });
const response = await api.request('https://example.com/health');
console.log(await response.text());
```

Run `node --test` to execute the deterministic tests. No install step is needed.

## Behavior

- Retries network errors, 408, 429 and 5xx responses for safe methods only.
- Uses exponential backoff with jitter; respects a numeric Retry-After up to 60 seconds.
- Uses an AbortController per attempt and honors an external abort signal.
- Opens the circuit after repeated failures; after a cooldown, one recovery probe is allowed.
- Returns a native Response or throws HttpError/CircuitOpenError.

The circuit state belongs to one client instance. This is a small building block, not a distributed rate limiter. Callers should set timeouts and decide whether an operation is safe to retry.

MIT licensed.
