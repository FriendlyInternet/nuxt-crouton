import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { extractCommands, PAGE, MARKER } from './clean-room-commands.mjs'

const block = lines => `${MARKER}\n\`\`\`bash\n${lines.join('\n')}\n\`\`\`\n`

test('the real page yields 1-5 commands starting with crouton init', () => {
  const cmds = extractCommands(readFileSync(PAGE, 'utf8'))
  assert.ok(cmds.length >= 1 && cmds.length <= 5)
  assert.match(cmds[0], /^npx @fyit\/crouton-cli init /)
  assert.ok(cmds.at(-1) === 'pnpm dev')
})

test('CLI entry point prints the same commands as the parser', () => {
  const out = execFileSync('node', ['scripts/clean-room-commands.mjs'], { encoding: 'utf8' }).trim().split('\n')
  assert.deepEqual(out, extractCommands(readFileSync(PAGE, 'utf8')))
})

test('editing the block changes what the check would run', () => {
  assert.deepEqual(extractCommands(block(['echo wrong'])), ['echo wrong'])
})

test('rejects missing marker, duplicate marker, more than 5 commands, empty block', () => {
  assert.throws(() => extractCommands('no marker'), /exactly one/)
  assert.throws(() => extractCommands(block(['a']) + block(['b'])), /exactly one/)
  assert.throws(() => extractCommands(block(['1', '2', '3', '4', '5', '6'])), /max is 5/)
  assert.throws(() => extractCommands(block([''])), /empty/)
  assert.throws(() => extractCommands(`${MARKER}\ntext\n\`\`\`bash\na\n\`\`\``), /fenced/)
})
