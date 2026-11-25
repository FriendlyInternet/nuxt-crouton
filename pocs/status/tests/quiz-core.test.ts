import { describe, expect, it } from 'vitest'
import { answerLine, canSend, parseAnswers, quizStatements, type QuizPick } from '../app/utils/quiz-core'
import { buildCardReply } from '../server/utils/cards-answer-core'

// Own fixture: 3 statements × 3 choices, plus an answer `key` and a per-question `a` that must
// never come back out of quizStatements (the key must not reach the browser).
const SECRET = 'SECRET-KEY-XYZ'
const payload = {
  pr: 3715,
  key: SECRET,
  questions: [
    { statement: 'The card posts on', choices: ['the PR', 'the issue the quiz sits on', 'the epic'], a: 'B' },
    { statement: 'A quiz answer can be', choices: ['one letter per statement', 'ok', 'free text'], a: 'A' },
    { statement: 'Send is enabled', choices: ['always', 'after one pick', 'after every pick'], a: 'C' }
  ]
}
const statements = quizStatements(payload)
const quizCard = { kind: 'quiz', sourceType: 'pr', sourceNumber: 3715, askedAt: '2026-11-10T00:00:00Z', payload }

describe('quiz-core', () => {
  // covers: T1
  it('reads the three statements with their three choices', () => {
    expect(statements).toHaveLength(3)
    expect(statements[0]).toEqual({ statement: 'The card posts on', choices: ['the PR', 'the issue the quiz sits on', 'the epic'] })
  })

  // covers: T1
  it('carries nothing of the answer key or the per-question answer', () => {
    const s = JSON.stringify(statements)
    expect(s).not.toContain(SECRET)
    expect(s).not.toContain('"a"')
    expect(s).not.toContain('"key"')
  })

  // covers: T1
  it('picks B, A, C → "1B 2A 3C"', () => {
    expect(answerLine(statements, { 1: 'B', 2: 'A', 3: 'C' })).toBe('1B 2A 3C')
  })

  // covers: T1
  it('a ? pick stays in the line', () => {
    expect(answerLine(statements, { 1: 'B', 2: '?', 3: 'C' })).toBe('1B 2? 3C')
  })

  // covers: T1
  it('cannot send until every statement has a pick; answerLine is null meanwhile', () => {
    const steps: Record<number, QuizPick>[] = [{}, { 1: 'B' }, { 1: 'B', 2: 'A' }]
    for (const p of steps) {
      expect(canSend(statements, p)).toBe(false)
      expect(answerLine(statements, p)).toBeNull()
    }
    expect(canSend(statements, { 1: 'B', 2: 'A', 3: 'C' })).toBe(true)
    expect(canSend([], {})).toBe(false)
  })

  // covers: T1
  it('the produced line is read by the quiz parser as one letter per statement', () => {
    const line = answerLine(statements, { 1: 'B', 2: 'A', 3: 'C' })!
    expect(parseAnswers(line, 3)).toEqual({ answers: { 1: 'B', 2: 'A', 3: 'C' } })
    expect(parseAnswers('1B 2? 3C', 3)).toEqual({ answers: { 1: 'B', 2: '?', 3: 'C' } })
  })

  // covers: T1
  it('ok is never a quiz answer', () => {
    expect(parseAnswers('ok', 3).error).toBeTruthy()
    expect(buildCardReply(quizCard, { verdict: 'ok' }).error).toBeTruthy()
    expect(buildCardReply(quizCard, { answer: 'ok' }).error).toBeTruthy()
    expect(buildCardReply(quizCard, { answer: '1B 2A 3C' }).data).toEqual({ kind: 'pr', number: 3715, body: '1B 2A 3C' })
  })

  // covers: T1
  it('drops malformed questions (no statement, or not exactly three string choices)', () => {
    expect(quizStatements({ questions: [{ statement: 'x', choices: ['a', 'b'] }, { choices: ['a', 'b', 'c'] }, { statement: 'y', choices: ['a', 'b', 3] }] })).toEqual([])
    expect(quizStatements(null)).toEqual([])
    expect(quizStatements({})).toEqual([])
  })
})
