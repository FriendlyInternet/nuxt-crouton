/**
 * @crouton-package crouton-sales
 * @description The till's last known offset to the cloud clock (#814, #2769).
 *
 * The pusher updates it from every ingest reply's `serverNow`; config capture
 * reads it so edit times are comparable across machines. Zero until the first
 * reply (a till that never reached the cloud has nothing to compare against).
 */
import { clockOffset } from './config-conflict'

let offsetMs = 0

export function getClockOffset(): number {
  return offsetMs
}

export function setClockOffset(ms: number): void {
  if (Number.isFinite(ms)) offsetMs = ms
}

/** Learn the offset from one ingest round trip. */
export function updateClockOffset(serverNowMs: unknown, sentAtMs: number, receivedAtMs: number): void {
  if (typeof serverNowMs !== 'number') return
  setClockOffset(clockOffset(serverNowMs, sentAtMs, receivedAtMs))
}
