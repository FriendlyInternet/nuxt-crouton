/**
 * #4516 — the panel's top row is the calendar's own month/week label row, with the
 * full-screen close (`#toolbar-end`) at its right end and the month ↔ week toggle
 * at its left end (`#header-start`); no row under the calendar. Reads the real .vue templates (the SFCs need the Nuxt UI runtime to
 * mount), same style as location-tabs-template.test.ts.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parse } from 'vue/compiler-sfc'

const ELEMENT = 1
const DIRECTIVE = 7
type Node = any

function load(name: string) {
  const file = resolve(__dirname, `../app/components/${name}`)
  const source = readFileSync(file, 'utf8')
  const { descriptor, errors } = parse(source, { filename: file })
  expect(errors).toEqual([])
  return { source, ast: descriptor.template!.ast!, template: descriptor.template!.content }
}

const elements = (node: Node): Node[] => (node.children ?? []).filter((c: Node) => c.type === ELEMENT)
const all = (node: Node): Node[] => elements(node).flatMap(c => [c, ...all(c)])
const find = (ast: Node, tag: string) => all(ast).filter(n => n.tag === tag)
/** A directive prop `v-<name>:<arg>` (element nodes always carry a props array) */
const isDirective = (p: Node, name: string, arg: string) => p.type === DIRECTIVE && p.name === name && p.arg?.content === arg
const isPlainDirective = (p: Node, name: string) => p.type === DIRECTIVE && p.name === name && !p.arg
const directive = (node: Node, name: string, arg?: string): string | undefined => {
  const match = arg ? (p: Node) => isDirective(p, name, arg) : (p: Node) => isPlainDirective(p, name)
  return node.props.find(match)?.exp?.content
}

/** The `<template #name>` child of a component, if any */
const slotTemplate = (node: Node, name: string): Node | undefined =>
  elements(node).find(c => c.tag === 'template' && c.props.some((p: Node) => isDirective(p, 'slot', name)))

const calendar = load('Calendar.vue')
const panel = load('Panel.vue')

describe('panel header row + fold handle (#4516)', () => {
  it('Calendar.vue forwards #header-end and today on both Week and Month', () => {
    for (const tag of ['CroutonCalendarWeek', 'CroutonCalendarMonth']) {
      const [node] = find(calendar.ast, tag)
      expect(node, tag).toBeTruthy()
      expect(directive(node, 'on', 'today')).toBe(`emit('today')`)
      for (const name of ['header-start', 'header-end']) {
        const tpl = slotTemplate(node, name)
        expect(tpl, `${tag} #${name}`).toBeTruthy()
        expect(directive(tpl, 'if')).toContain(`$slots['${name}']`)
        expect(find(tpl, 'slot').some(s => (s.props ?? []).some((p: Node) => p.name === 'name' && p.value?.content === name))).toBe(true)
      }
    }
    expect(calendar.source).toMatch(/'today':\s*\[\]/)
  })

  it('Panel has no showCalendar; toolbar-end goes onto the calendar label row; the label runs goToToday', () => {
    expect(panel.source).not.toMatch(/showCalendar/)
    const [cal] = find(panel.ast, 'CroutonBookingsCalendar')
    expect(cal).toBeTruthy()
    expect(directive(cal, 'on', 'today')).toBe('onGoToToday')
    const tpl = slotTemplate(cal, 'header-end')
    expect(tpl).toBeTruthy()
    expect(find(tpl, 'slot').some(s => (s.props ?? []).some((p: Node) => p.name === 'name' && p.value?.content === 'toolbar-end'))).toBe(true)
    // the calendar always renders (no fold-away v-if any more)
    expect(directive(cal, 'if')).toBeUndefined()
    expect(panel.source).toMatch(/const onGoToToday = store\.goToToday/)
  })

  it('the month ↔ week toggle sits in the calendar\'s #header-start (left of the label), bound to calendarView; no row under the calendar', () => {
    const [cal] = find(panel.ast, 'CroutonBookingsCalendar')
    const start = slotTemplate(cal, 'header-start')
    expect(start).toBeTruthy()
    const [toggle] = find(start, 'CroutonBookingsCalendarFoldHandle')
    expect(toggle).toBeTruthy()
    expect(directive(toggle, 'model')).toBe('calendarView')
    // exactly one toggle in the panel, so nothing is left under the calendar
    expect(find(panel.ast, 'CroutonBookingsCalendarFoldHandle')).toHaveLength(1)
    expect(panel.template).not.toMatch(/Drag\/tap handle/)
  })

  it('the handle label exists in every locale', () => {
    for (const lang of ['en', 'nl', 'fr']) {
      const json = JSON.parse(readFileSync(resolve(__dirname, `../i18n/locales/${lang}.json`), 'utf8'))
      expect(typeof json.bookings.panel.calendarHandle).toBe('string')
      expect(json.bookings.panel.calendarHandle.length).toBeGreaterThan(0)
    }
  })
})
