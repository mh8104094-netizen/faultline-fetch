export class CircuitOpenError extends Error {
  constructor() { super('Circuit is open'); this.name = 'CircuitOpenError'; }
}

export class HttpError extends Error {
  constructor(status, response) {
    super('HTTP ' + status);
    this.name = 'HttpError';
    this.status = status;
    this.response = response;
  }
}

/** Create an isolated HTTP client. Injectable dependencies keep tests deterministic. */
export function createClient({
  fetchImpl = globalThis.fetch,
  retries = 2,
  baseDelayMs = 200,
  timeoutMs = 5000,
  failureThreshold = 5,
  resetAfterMs = 30000,
  now = () => Date.now(),
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
  random = Math.random,
} = {}) {
  if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl must be a function');
  for (const [name, value] of Object.entries({ retries, baseDelayMs, timeoutMs, failureThreshold, resetAfterMs })) {
    if (!Number.isSafeInteger(value) || value < (name === 'failureThreshold' ? 1 : 0)) {
      throw new RangeError(name + ' must be a valid non-negative integer');
    }
  }

  let failures = 0;
  let openUntil = 0;
  let probeInFlight = false;
  const state = () => openUntil === 0 ? 'closed' : now() < openUntil || probeInFlight ? 'open' : 'half-open';

  async function request(input, init = {}) {
    const current = state();
    if (current === 'open') throw new CircuitOpenError();
    const probe = current === 'half-open';
    if (probe) probeInFlight = true;
    const method = (init.method || 'GET').toUpperCase();
    const canRetry = ['GET', 'HEAD', 'OPTIONS'].includes(method);
    const maxAttempts = canRetry ? retries + 1 : 1;

    try {
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const controller = new AbortController();
        const external = init.signal;
        if (external?.aborted) throw external.reason ?? new DOMException('Aborted', 'AbortError');
        const onAbort = () => controller.abort(external.reason);
        external?.addEventListener('abort', onAbort, { once: true });
        const timer = timeoutMs ? setTimeout(() => controller.abort(new Error('Request timed out')), timeoutMs) : null;
        let error;
        try {
          const response = await fetchImpl(input, { ...init, signal: controller.signal });
          if (response.ok) { failures = 0; openUntil = 0; return response; }
          error = new HttpError(response.status, response);
          if (response.status !== 408 && response.status !== 429 && response.status < 500) throw error;
        } catch (caught) {
          error = caught;
          if (external?.aborted) throw error;
          if (error instanceof HttpError && ![408, 429].includes(error.status) && error.status < 500) throw error;
        } finally {
          if (timer) clearTimeout(timer);
          external?.removeEventListener('abort', onAbort);
        }

        if (attempt === maxAttempts - 1) throw error;
        const retryAfterHeader = error instanceof HttpError ? error.response.headers?.get('retry-after') : null;
        const retryAfter = retryAfterHeader === null ? NaN : Number(retryAfterHeader);
        const delay = Number.isFinite(retryAfter) && retryAfter >= 0 && retryAfter <= 60
          ? retryAfter * 1000
          : Math.floor(baseDelayMs * 2 ** attempt * (0.5 + random() / 2));
        await sleep(delay);
      }
    } catch (error) {
      if (!init.signal?.aborted) {
        failures++;
        if (failures >= failureThreshold) openUntil = now() + resetAfterMs;
      }
      throw error;
    } finally {
      if (probe) probeInFlight = false;
    }
  }

  return { request, get state() { return state(); }, get failures() { return failures; } };
}
