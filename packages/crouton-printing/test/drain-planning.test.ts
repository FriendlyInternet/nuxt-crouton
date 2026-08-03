import { describe, it, expect } from 'vitest'
import { groupJobsByPrinter, shouldResolveStatusRead, NEEDED_STATUS_BYTES } from '../server/utils/escpos-drainer'

// ─────────────────────────────────────────────────────────────────────────────
// #1539 — the two GENUINELY-testable pure decisions extracted from the latency
// work. The shell backgrounding (`&`/`wait`) and the real socket timing /
// parallelism are NOT unit-testable and are field-verified by the owner on the
// actual RUT956 — those get no fake coverage here.
// ─────────────────────────────────────────────────────────────────────────────

// ── Lever 1: group pending jobs by printer IP ────────────────────────────────
// The parallelism decision. Different printers may drain CONCURRENTLY; jobs to
// the SAME printer must stay in ONE serial group (Epson TM accepts a single
// :9100 connection at a time — parallelising within a printer garbles tickets).
describe('groupJobsByPrinter', () => {
  it('returns no groups for no jobs', () => {
    expect(groupJobsByPrinter([])).toEqual([])
  })

  it('keeps every job for one printer in a single, order-preserving group', () => {
    const rows = [
      { id: 'a', printerIp: '192.168.1.72' },
      { id: 'b', printerIp: '192.168.1.72' },
      { id: 'c', printerIp: '192.168.1.72' }
    ]
    const groups = groupJobsByPrinter(rows)
    expect(groups).toHaveLength(1)
    expect(groups[0].map(r => r.id)).toEqual(['a', 'b', 'c'])
  })

  it('splits distinct printers into separate groups (these are the parallel units)', () => {
    const rows = [
      { id: 'a', printerIp: '192.168.1.72' },
      { id: 'b', printerIp: '192.168.1.70' }
    ]
    expect(groupJobsByPrinter(rows)).toHaveLength(2)
  })

  it('never splits one printer across groups even when jobs interleave', () => {
    const rows = [
      { id: 'bar1', printerIp: '192.168.1.72' },
      { id: 'keuken1', printerIp: '192.168.1.70' },
      { id: 'bar2', printerIp: '192.168.1.72' },
      { id: 'keuken2', printerIp: '192.168.1.70' }
    ]
    const groups = groupJobsByPrinter(rows)
    const bar = groups.find(g => g[0].printerIp === '192.168.1.72')!
    const keuken = groups.find(g => g[0].printerIp === '192.168.1.70')!
    expect(bar.map(r => r.id)).toEqual(['bar1', 'bar2'])
    expect(keuken.map(r => r.id)).toEqual(['keuken1', 'keuken2'])
  })

  it('preserves first-seen printer order across groups (deterministic output)', () => {
    const rows = [
      { id: 'a', printerIp: '10.0.0.2' },
      { id: 'b', printerIp: '10.0.0.1' }
    ]
    expect(groupJobsByPrinter(rows).map(g => g[0].printerIp)).toEqual(['10.0.0.2', '10.0.0.1'])
  })

  it('collapses IP-less jobs into ONE group (serial, each fails on its own — never parallel)', () => {
    const rows = [
      { id: 'a', printerIp: null },
      { id: 'b', printerIp: '' },
      { id: 'c', printerIp: undefined }
    ]
    const groups = groupJobsByPrinter(rows)
    expect(groups).toHaveLength(1)
    expect(groups[0].map(r => r.id)).toEqual(['a', 'b', 'c'])
  })
})

// ── Lever 2: early-return status read ────────────────────────────────────────
// Resolve the DLE-EOT read the INSTANT the full reply (3 bytes) has arrived,
// instead of always waiting the fixed hold window. The time CAP stays the
// caller's timeout (unchanged pre-flight semantics — we only change WHEN we
// stop waiting, never WHAT we conclude); this is purely the "have we received
// enough to conclude?" decision.
describe('shouldResolveStatusRead', () => {
  it('needs the three DLE-EOT status bytes by default', () => {
    expect(NEEDED_STATUS_BYTES).toBe(3)
  })

  it('keeps waiting until the full reply has arrived', () => {
    expect(shouldResolveStatusRead(0)).toBe(false)
    expect(shouldResolveStatusRead(1)).toBe(false)
    expect(shouldResolveStatusRead(2)).toBe(false)
  })

  it('resolves the instant all three bytes are in (fast printer → no fixed wait)', () => {
    expect(shouldResolveStatusRead(3)).toBe(true)
  })

  it('resolves when more than enough bytes arrive in a single chunk', () => {
    expect(shouldResolveStatusRead(5)).toBe(true)
  })

  it('honours an explicit needed-bytes argument', () => {
    expect(shouldResolveStatusRead(2, 2)).toBe(true)
    expect(shouldResolveStatusRead(1, 2)).toBe(false)
  })
})
