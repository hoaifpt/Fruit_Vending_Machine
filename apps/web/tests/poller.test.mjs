import test from 'node:test'
import assert from 'node:assert/strict'
import { createPoller, normalizeInterval, MIN_POLL_MS } from '../src/lib/poller.ts'
import { stopsPolling } from '../src/admin/useApi.ts'
import { ApiError } from '../src/api/client.ts'

/** Manual timers and visibility, so the schedule is checked without waiting. */
function harness({ intervalMs = 5000, hidden = false } = {}) {
  const timers = new Map()
  let nextId = 1
  let isHidden = hidden
  const listeners = new Set()
  const runs = []
  const pending = []
  const poller = createPoller({
    intervalMs,
    run: kind => { runs.push(kind); return new Promise(resolve => pending.push(resolve)) },
    visibility: { hidden: () => isHidden, subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener) } },
    setTimer: (callback, ms) => { const id = nextId++; timers.set(id, { callback, ms }); return id },
    clearTimer: id => { timers.delete(id) },
  })
  const flush = () => new Promise(resolve => setImmediate(resolve))
  return {
    poller, runs, timers, listeners,
    async settle(keepGoing = true) { pending.shift()(keepGoing); await flush() },
    fire() { const [id, timer] = [...timers][0]; timers.delete(id); timer.callback() },
    setHidden(value) { isHidden = value; listeners.forEach(listener => listener()) },
  }
}

test('interval is optional and clamped to a safe minimum', () => {
  assert.equal(normalizeInterval(undefined), 0)
  assert.equal(normalizeInterval(0), 0)
  assert.equal(normalizeInterval(-5), 0)
  assert.equal(normalizeInterval(Number.NaN), 0)
  assert.equal(normalizeInterval(100), MIN_POLL_MS)
  assert.equal(normalizeInterval(15000), 15000)
})
test('without an interval it loads once and never schedules or listens', async () => {
  const h = harness({ intervalMs: 0 })
  h.poller.start()
  await h.settle()
  assert.deepEqual(h.runs, ['initial'])
  assert.equal(h.timers.size, 0)
  assert.equal(h.listeners.size, 0)
})
test('next poll is scheduled only after the previous load settles (no overlapping requests)', async () => {
  const h = harness()
  h.poller.start()
  assert.equal(h.timers.size, 0, 'nothing scheduled while the first load runs')
  await h.settle()
  assert.equal(h.timers.size, 1)
  assert.equal([...h.timers.values()][0].ms, 5000)
  h.fire()
  assert.deepEqual(h.runs, ['initial', 'poll'])
  assert.equal(h.timers.size, 0)
  h.setHidden(false) // a visibility event while a load runs must not start a second one
  assert.deepEqual(h.runs, ['initial', 'poll'])
  await h.settle()
  assert.equal(h.timers.size, 1)
})
test('pauses while the tab is hidden and refreshes at once when it shows again', async () => {
  const h = harness()
  h.poller.start()
  await h.settle()
  h.setHidden(true)
  assert.equal(h.timers.size, 0, 'timer cleared when hidden')
  h.setHidden(false)
  assert.deepEqual(h.runs, ['initial', 'visible'])
  await h.settle()
  assert.equal(h.timers.size, 1)
})
test('a load that finishes while hidden does not schedule another', async () => {
  const h = harness()
  h.poller.start()
  h.setHidden(true)
  await h.settle()
  assert.equal(h.timers.size, 0)
  assert.equal(h.poller.state.inflight, false)
})
test('stops for good when a load reports a fatal error (401/403)', async () => {
  const h = harness()
  h.poller.start()
  await h.settle(false)
  assert.equal(h.poller.state.stopped, true)
  assert.equal(h.timers.size, 0)
  h.setHidden(true); h.setHidden(false)
  assert.deepEqual(h.runs, ['initial'])
})
test('dispose clears the timer and the visibility listener', async () => {
  const h = harness()
  h.poller.start()
  await h.settle()
  h.poller.dispose()
  assert.equal(h.timers.size, 0)
  assert.equal(h.listeners.size, 0)
})
test('only 401 and 403 stop polling', () => {
  assert.equal(stopsPolling(new ApiError(401, 'x')), true)
  assert.equal(stopsPolling(new ApiError(403, 'x')), true)
  assert.equal(stopsPolling(new ApiError(500, 'x')), false)
  assert.equal(stopsPolling(new ApiError(0, 'x')), false)
  assert.equal(stopsPolling(new Error('x')), false)
})
