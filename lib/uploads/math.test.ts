import assert from 'node:assert/strict'
import test from 'node:test'
import { backoffBaseMs, chunkCount, chunkRange, isRetryableStatus, matchesReselect, missingChunkIndexes, progressPercent } from './math'

test('chunkCount and chunkRange', () => {
  assert.equal(chunkCount(100, 64), 2)
  assert.equal(chunkCount(64, 64), 1)
  assert.deepEqual(chunkRange(0, 64, 100), { start: 0, end: 64 })
  assert.deepEqual(chunkRange(1, 64, 100), { start: 64, end: 100 })
})

test('progressPercent aggregates confirmed bytes', () => {
  assert.equal(progressPercent(0, 1000), 0)
  assert.equal(progressPercent(500, 1000), 50)
  assert.equal(progressPercent(1000, 1000), 100)
  assert.equal(progressPercent(1500, 1000), 100)
  assert.equal(progressPercent(100, 0), 0)
})

test('missingChunkIndexes reconciles received chunks', () => {
  assert.deepEqual(missingChunkIndexes([0, 1, 3], 5), [2, 4])
  assert.deepEqual(missingChunkIndexes([], 3), [0, 1, 2])
  assert.deepEqual(missingChunkIndexes([0, 1, 2], 3), [])
})

test('backoffBaseMs grows exponentially', () => {
  assert.equal(backoffBaseMs(1, 100), 100)
  assert.equal(backoffBaseMs(2, 100), 200)
  assert.equal(backoffBaseMs(3, 100), 400)
})

test('isRetryableStatus distinguishes transient from permanent failures', () => {
  assert.equal(isRetryableStatus(0), true)
  assert.equal(isRetryableStatus(408), true)
  assert.equal(isRetryableStatus(429), true)
  assert.equal(isRetryableStatus(500), true)
  assert.equal(isRetryableStatus(400), false)
  assert.equal(isRetryableStatus(413), false)
  assert.equal(isRetryableStatus(404), false)
})

test('matchesReselect validates a reselected file', () => {
  const record = { name: 'photo.jpg', sizeBytes: 100 }
  assert.equal(matchesReselect(record, { name: 'photo.jpg', size: 100 }), true)
  assert.equal(matchesReselect(record, { name: 'other.jpg', size: 100 }), false)
  assert.equal(matchesReselect(record, { name: 'photo.jpg', size: 200 }), false)
})
