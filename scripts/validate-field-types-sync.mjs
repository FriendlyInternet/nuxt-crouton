#!/usr/bin/env node
/**
 * Validate Field Types Sync
 *
 * Ensures field types in the Claude skill match the manifests' field types.
 * This script is used in CI to catch sync issues early.
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { register } from 'node:module'

const __dirname = dirname(fileURLToPath(import.meta.url))
const projectRoot = join(__dirname, '..')

// Claude skill field types
const skillPath = join(projectRoot, '.claude/skills/crouton.md')

/**
 * Canonical field type names from every package manifest, by importing each package's crouton.manifest.ts directly.
 */
async function extractManifestFieldTypes() {
  // The CI job runs without `pnpm install`, so `@fyit/crouton-core/...` doesn't resolve from node_modules.
  // Map that package to its in-repo source for the manifest imports.
  const coreRoot = pathToFileURL(join(projectRoot, 'packages/crouton-core') + '/').href
  const hooks = `export async function resolve(spec, ctx, next) {
    if (spec.startsWith('@fyit/crouton-core/')) {
      const rest = spec.slice('@fyit/crouton-core/'.length)
      return next(${JSON.stringify(coreRoot)} + rest + (rest.endsWith('.ts') ? '' : '.ts'), ctx)
    }
    return next(spec, ctx)
  }
  export async function load(url, ctx, next) {
    // Manifests import schema JSON without \`with { type: 'json' }\`; supply the attribute so bare Node can read them.
    if (url.endsWith('.json')) return next(url, { ...ctx, importAttributes: { ...ctx.importAttributes, type: 'json' } })
    return next(url, ctx)
  }`
  register('data:text/javascript,' + encodeURIComponent(hooks))
  const { readdirSync, existsSync } = await import('node:fs')
  const pkgsDir = join(projectRoot, 'packages')
  const types = new Set()
  for (const pkg of readdirSync(pkgsDir).sort()) {
    const file = join(pkgsDir, pkg, 'crouton.manifest.ts')
    if (!existsSync(file)) continue
    // An unreadable manifest is a failure, never a skip.
    const mod = await import(pathToFileURL(file).href)
    for (const name of Object.keys(mod.default?.fieldTypes ?? {})) types.add(name)
  }
  return [...types]
}

/**
 * Extract field types from skill markdown table
 * Handles format: | User Says | Schema Type | Example |
 */
function extractSkillFieldTypes(content) {
  // Look for the Field Types table with Schema Type column
  const tableMatch = content.match(/### Field Types[\s\S]*?\| User Says \| Schema Type \| Example \|[\s\S]*?\n((?:\|[^\n]+\n)+)/i)
  if (!tableMatch) {
    // Fallback: look for simpler Type | Zod format
    const simpleMatch = content.match(/\| Type \| Zod[\s\S]*?\n((?:\|[^\n]+\n)+)/i)
    if (!simpleMatch) return null

    const rows = simpleMatch[1].trim().split('\n')
    const types = []

    for (const row of rows) {
      if (row.match(/^\|\s*[-:]+/)) continue
      const cells = row.split('|').filter(c => c.trim())
      if (cells.length > 0) {
        const type = cells[0].trim().replace(/`/g, '')
        if (type && !type.includes('-')) {
          types.push(type)
        }
      }
    }
    return types.length > 0 ? types : null
  }

  const rows = tableMatch[1].trim().split('\n')
  const types = []

  for (const row of rows) {
    // Skip separator row
    if (row.match(/^\|\s*[-:]+/)) continue

    const cells = row.split('|').filter(c => c.trim())
    // Schema Type is in the second column
    if (cells.length >= 2) {
      const type = cells[1].trim().replace(/`/g, '')
      if (type && !type.includes('-') && !type.includes('Schema Type')) {
        types.push(type)
      }
    }
  }

  // Remove duplicates (skill file may list same type multiple times)
  return [...new Set(types)]
}

function readFileSafe(path) {
  try {
    return readFileSync(path, 'utf-8')
  } catch {
    return null
  }
}

function arrayEquals(a, b) {
  if (!a || !b) return false
  if (a.length !== b.length) return false
  const sortedA = [...a].sort()
  const sortedB = [...b].sort()
  return sortedA.every((v, i) => v === sortedB[i])
}

async function main() {
  console.log('🔍 Validating field types sync...\n')

  let hasErrors = false
  const results = {}

  // 1. Extract generator field types (source of truth)
  const generatorTypes = await extractManifestFieldTypes()
  if (generatorTypes.length === 0) {
    console.error('❌ Could not extract field types from manifests')
    process.exit(1)
  }

  console.log(`📦 Manifests (source of truth): ${generatorTypes.length} types`)
  console.log(`   Types: ${generatorTypes.join(', ')}\n`)
  results.generator = generatorTypes

  // 2. Check skill file field types
  const skillContent = readFileSafe(skillPath)
  if (skillContent) {
    const skillTypes = extractSkillFieldTypes(skillContent)
    if (skillTypes) {
      results.skill = skillTypes
      if (arrayEquals(generatorTypes, skillTypes)) {
        console.log(`✅ Claude Skill: ${skillTypes.length} types (matches generator)`)
      } else {
        console.log(`❌ Claude Skill: ${skillTypes.length} types (MISMATCH)`)
        console.log(`   Types: ${skillTypes.join(', ')}`)

        const missing = generatorTypes.filter(t => !skillTypes.includes(t))
        const extra = skillTypes.filter(t => !generatorTypes.includes(t))

        if (missing.length > 0) {
          console.log(`   Missing: ${missing.join(', ')}`)
        }
        if (extra.length > 0) {
          console.log(`   Extra: ${extra.join(', ')}`)
        }
        hasErrors = true
      }
    } else {
      console.log('⚠️  Claude Skill: Could not extract field types from table')
    }
  } else {
    console.log('⚠️  Claude Skill: crouton.md not found')
  }

  console.log('')

  if (hasErrors) {
    console.log('❌ Field types are out of sync!')
    console.log('\nTo fix:')
    console.log('1. Update the mismatched files to match the generator')
    console.log('2. Run this script again to verify')
    process.exit(1)
  } else {
    console.log('✅ All field types are in sync!')
    process.exit(0)
  }
}

main()
