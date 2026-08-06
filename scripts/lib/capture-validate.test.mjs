import { test } from 'node:test'
import assert from 'node:assert/strict'
import { colorsAreFlat, looksLikeErrorPage } from './capture-validate.mjs'

test('colorsAreFlat: uniform samples are flat', () => {
  const samples = Array.from({ length: 16 }, () => [255, 255, 255, 255])
  assert.equal(colorsAreFlat(samples), true)
})

test('colorsAreFlat: varied samples are not flat', () => {
  const samples = [
    [255, 255, 255, 255],
    [10, 20, 30, 255],
    [200, 100, 50, 255],
  ]
  assert.equal(colorsAreFlat(samples), false)
})

test('colorsAreFlat: empty/invalid input is not flat', () => {
  assert.equal(colorsAreFlat([]), false)
  assert.equal(colorsAreFlat(null), false)
})

test('colorsAreFlat: within-tolerance noise still counts as flat', () => {
  const samples = [
    [255, 255, 255, 255],
    [254, 255, 254, 255],
    [255, 254, 255, 255],
  ]
  assert.equal(colorsAreFlat(samples, 2), true)
})

test('looksLikeErrorPage: 4xx/5xx status is an error page', () => {
  assert.equal(looksLikeErrorPage({ status: 404, text: '', title: '' }), true)
  assert.equal(looksLikeErrorPage({ status: 500, text: '', title: '' }), true)
  assert.equal(looksLikeErrorPage({ status: 200, text: '', title: '' }), false)
})

test('looksLikeErrorPage: Nuxt/Nitro error text is an error page', () => {
  assert.equal(looksLikeErrorPage({ status: 200, text: 'This page could not be found', title: '' }), true)
  assert.equal(looksLikeErrorPage({ status: 200, text: '', title: 'Nuxt Error' }), true)
  assert.equal(looksLikeErrorPage({ status: 200, text: 'Internal Server Error', title: '' }), true)
})

test('looksLikeErrorPage: normal UI content is not an error page', () => {
  assert.equal(looksLikeErrorPage({ status: 200, text: 'Welcome to the dashboard', title: 'Dashboard' }), false)
})
