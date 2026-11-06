import { describe, it, expect } from 'vitest'
import { sortAppCards } from '../app/utils/app-cards'

const card = (app: string | null, n: number) => ({ app, toTest: Array.from({ length: n }) })

describe('sortAppCards', () => {
  it('does not throw on a null app and puts General last when it ties', () => {
    const sorted = sortAppCards([card(null, 1), card('velo', 1), card('alpha', 0), card('bare', 1)])
    expect(sorted.map(c => c.app)).toEqual(['bare', 'velo', null, 'alpha'])
  })
  it('sorts General alone among ties after named apps', () => {
    expect(sortAppCards([card(null, 0), card('a', 0)]).map(c => c.app)).toEqual(['a', null])
  })
})
