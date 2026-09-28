import test from 'node:test';
import assert from 'node:assert/strict';
import { createClient, CircuitOpenError, HttpError } from './index.js';

test('retries GET on server errors and returns the eventual response', async () => {
  let calls = 0;
  const delays = [];
  const client = createClient({ fetchImpl: async () => {
    calls++;
    return new Response('', { status: calls < 3 ? 503 : 200 });
  }, sleep: async ms => delays.push(ms), random: () => 0, baseDelayMs: 100 });
  assert.equal((await client.request('/health')).status, 200);
  assert.equal(calls, 3);
  assert.deepEqual(delays, [50, 100]);
  assert.equal(client.state, 'closed');
});

test('never retries a POST automatically', async () => {
  let calls = 0;
  const client = createClient({ fetchImpl: async () => { calls++; return new Response('', { status: 503 }); } });
  await assert.rejects(client.request('/orders', { method: 'POST' }), HttpError);
  assert.equal(calls, 1);
});

test('opens after repeated failures and permits one recovery probe', async () => {
  let time = 0;
  let healthy = false;
  const client = createClient({ fetchImpl: async () => new Response('', { status: healthy ? 200 : 503 }), retries: 0, failureThreshold: 2, resetAfterMs: 100, now: () => time });
  await assert.rejects(client.request('/'), HttpError);
  await assert.rejects(client.request('/'), HttpError);
  await assert.rejects(client.request('/'), CircuitOpenError);
  time = 100;
  assert.equal(client.state, 'half-open');
  healthy = true;
  assert.equal((await client.request('/')).status, 200);
  assert.equal(client.state, 'closed');
});

test('does not retry a client error or an externally aborted request', async () => {
  let calls = 0;
  const client = createClient({ fetchImpl: async () => { calls++; return new Response('', { status: 404 }); } });
  await assert.rejects(client.request('/missing'), error => error.status === 404);
  assert.equal(calls, 1);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(client.request('/', { signal: controller.signal }));
  assert.equal(calls, 1);
});
