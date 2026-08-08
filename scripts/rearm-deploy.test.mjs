/**
 * Contract for scripts/rearm-deploy.mjs (#2110) — proves the two re-arm decisions:
 *   • a dropped `pull_request` event is detected only when NO check run exists at all
 *     for the watched workflow on that PR's head SHA, the PR touches a watched path,
 *     and enough grace time has passed;
 *   • a starved/auto-cancelled run is detected only when it never started, sat queued
 *     past the threshold, and is the newest run for its (head SHA, workflow) pair —
 *     so a run that was already retried is never re-flagged.
 *
 *   node --test scripts/rearm-deploy.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { findDroppedPreviewEvents, findStarvedRuns } from './rearm-deploy.mjs'

const NOW = '2026-08-08T12:00:00Z'
const WATCH = ['pocs/', '.github/workflows/deploy-pocs.yml']
const CHECK_NAME = 'Deploy POCs (preview) / detect'

test('a PR with no check run at all for the workflow, past grace, touching a watched path is flagged', () => {
  const openPRs = [
    { number: 10, headSha: 'sha-a', updatedAt: '2026-08-08T11:45:00Z', changedFiles: ['pocs/foo/app.vue'] }
  ]
  const flagged = findDroppedPreviewEvents({
    openPRs, checkRuns: [], watchPathPrefixes: WATCH, workflowCheckName: CHECK_NAME, nowIso: NOW
  })
  assert.equal(flagged.length, 1)
  assert.equal(flagged[0].number, 10)
})

test('a PR that has ANY check run for the workflow (even pending/red) is left alone — event was received', () => {
  const openPRs = [
    { number: 11, headSha: 'sha-b', updatedAt: '2026-08-08T11:45:00Z', changedFiles: ['pocs/foo/app.vue'] }
  ]
  const checkRuns = [{ headSha: 'sha-b', workflowName: CHECK_NAME }]
  const flagged = findDroppedPreviewEvents({
    openPRs, checkRuns, watchPathPrefixes: WATCH, workflowCheckName: CHECK_NAME, nowIso: NOW
  })
  assert.equal(flagged.length, 0)
})

test('a PR not touching a watched path is never flagged, even with no check run', () => {
  const openPRs = [
    { number: 12, headSha: 'sha-c', updatedAt: '2026-08-08T11:00:00Z', changedFiles: ['apps/velo/app.vue'] }
  ]
  const flagged = findDroppedPreviewEvents({
    openPRs, checkRuns: [], watchPathPrefixes: WATCH, workflowCheckName: CHECK_NAME, nowIso: NOW
  })
  assert.equal(flagged.length, 0)
})

test('a PR within the grace window is not yet flagged (event may still be about to arrive)', () => {
  const openPRs = [
    { number: 13, headSha: 'sha-d', updatedAt: '2026-08-08T11:58:00Z', changedFiles: ['pocs/foo/app.vue'] }
  ]
  const flagged = findDroppedPreviewEvents({
    openPRs, checkRuns: [], watchPathPrefixes: WATCH, workflowCheckName: CHECK_NAME, nowIso: NOW
  })
  assert.equal(flagged.length, 0)
})

// ── starved / auto-cancelled runs ──────────────────────────────────────────────
test('a cancelled run that never started and queued past the threshold is flagged', () => {
  const runs = [
    {
      id: 1, workflowId: 99, headSha: 'sha-e',
      conclusion: 'cancelled', createdAt: '2026-08-08T11:40:00Z',
      updatedAt: '2026-08-08T12:00:00Z', runStartedAt: null
    }
  ]
  const flagged = findStarvedRuns({ runs })
  assert.equal(flagged.length, 1)
  assert.equal(flagged[0].id, 1)
})

test('a cancelled run that DID start (e.g. user-cancelled mid-run) is not a starvation case', () => {
  const runs = [
    {
      id: 2, workflowId: 99, headSha: 'sha-f',
      conclusion: 'cancelled', createdAt: '2026-08-08T11:40:00Z',
      updatedAt: '2026-08-08T12:00:00Z', runStartedAt: '2026-08-08T11:41:00Z'
    }
  ]
  assert.equal(findStarvedRuns({ runs }).length, 0)
})

test('a run queued for less than the threshold is not flagged', () => {
  const runs = [
    {
      id: 3, workflowId: 99, headSha: 'sha-g',
      conclusion: 'cancelled', createdAt: '2026-08-08T11:55:00Z',
      updatedAt: '2026-08-08T12:00:00Z', runStartedAt: null
    }
  ]
  assert.equal(findStarvedRuns({ runs }).length, 0)
})

test('a successful run is never flagged', () => {
  const runs = [
    {
      id: 4, workflowId: 99, headSha: 'sha-h',
      conclusion: 'success', createdAt: '2026-08-08T11:30:00Z',
      updatedAt: '2026-08-08T11:35:00Z', runStartedAt: '2026-08-08T11:31:00Z'
    }
  ]
  assert.equal(findStarvedRuns({ runs }).length, 0)
})

test('cap retries at one: a starved run that already has a LATER run for the same (sha, workflow) is not re-flagged', () => {
  const runs = [
    {
      id: 5, workflowId: 99, headSha: 'sha-i',
      conclusion: 'cancelled', createdAt: '2026-08-08T11:00:00Z',
      updatedAt: '2026-08-08T11:20:00Z', runStartedAt: null
    },
    // the re-dispatched retry — newer createdAt for the same sha+workflow
    {
      id: 6, workflowId: 99, headSha: 'sha-i',
      conclusion: 'success', createdAt: '2026-08-08T11:25:00Z',
      updatedAt: '2026-08-08T11:35:00Z', runStartedAt: '2026-08-08T11:26:00Z'
    }
  ]
  const flagged = findStarvedRuns({ runs })
  assert.equal(flagged.length, 0)
})

test('the newest starved run among several attempts is the one flagged', () => {
  const runs = [
    {
      id: 7, workflowId: 99, headSha: 'sha-j',
      conclusion: 'cancelled', createdAt: '2026-08-08T10:00:00Z',
      updatedAt: '2026-08-08T10:20:00Z', runStartedAt: null
    },
    {
      id: 8, workflowId: 99, headSha: 'sha-j',
      conclusion: 'cancelled', createdAt: '2026-08-08T11:00:00Z',
      updatedAt: '2026-08-08T11:20:00Z', runStartedAt: null
    }
  ]
  const flagged = findStarvedRuns({ runs })
  assert.equal(flagged.length, 1)
  assert.equal(flagged[0].id, 8)
})
