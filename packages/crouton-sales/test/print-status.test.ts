import { describe, it, expect } from 'vitest'
import { SALES_PRINT_STATUS, bucketPrintStatuses } from '../shared/utils/print-status'

describe('SALES_PRINT_STATUS', () => {
  it('matches the generic print_jobs text codes', () => {
    expect(SALES_PRINT_STATUS).toEqual({ PENDING: '0', PRINTING: '1', COMPLETED: '2', FAILED: '9' })
  })
})

describe('bucketPrintStatuses', () => {
  it('none when there are no jobs', () => {
    expect(bucketPrintStatuses([])).toBe('none')
  })
  it('failed wins over everything', () => {
    expect(bucketPrintStatuses(['2', '9', '0'])).toBe('failed')
  })
  it('busy when any job is pending or printing (and none failed)', () => {
    expect(bucketPrintStatuses(['2', '1'])).toBe('busy')
    expect(bucketPrintStatuses(['0'])).toBe('busy')
  })
  it('done only when every job is completed', () => {
    expect(bucketPrintStatuses(['2', '2'])).toBe('done')
  })
})
