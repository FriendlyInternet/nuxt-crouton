#!/usr/bin/env node
/**
 * Validate Field Types Sync
 *
 * Ensures field types in MCP server match the generator's field types.
 * This script is used in CI to catch sync issues early.
 */

import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const projectRoot = join(__dirname, '..')

// Source of truth: the `fieldTypes` rows of every package's crouton.manifest.ts
const packagesDir = join(projectRoot, 'packages')

// MCP server field types
const mcpFieldTypesPath = join(
  projectRoot,
  'packages/crouton-mcp/src/utils/field-types.ts'
)

// Claude skill field types
const skillPath = join(projectRoot, '.claude/skills/crouton.md')

/**
 * Collect canonical field type names from every manifest's `fieldTypes` block
 * (rows look like `    string:    { label: 'String', ...`).
 */
function extractManifestFieldTypes() {
  const types = []
  for (const dir of readdirSync(packagesDir)) {
    const content = readFileSafe(join(packagesDir, dir, 'crouton.manifest.ts'))
    if (!content) continue
    const block = content.match(/\bfieldTypes:\s*\{([\s\S]*?)\n  \},?\n/)
    if (!block) continue
    for (const m of block[1].matchAll(/^\s{4}(\w+):\s*\{\s*label:/gm)) types.push(m[1])
  }
  // `reference` is a relation pseudo-type, not a schema field type the skill/MCP list
  return [...new Set(types)].filter(t => t !== 'reference')
}

/**
 * Extract field type names from MCP server's FIELD_TYPES object
 */
function extractMcpFieldTypes(content) {
  // Match FIELD_TYPES object - look for pattern: typeName: {
  // Only match top-level keys (those followed by an opening brace)
  const types = []

  // Find all lines that match: <word>: { (top-level keys in the object)
  // These are the field type names like string, text, number, etc.
  const regex = /^\s*(\w+):\s*\{$/gm
  let match

  // First, extract the FIELD_TYPES object content
  const objectMatch = content.match(/export const FIELD_TYPES[^=]*=\s*\{([\s\S]*?)\n\}/)
  if (!objectMatch) return null

  const objectContent = objectMatch[1]

  while ((match = regex.exec(objectContent)) !== null) {
    const key = match[1]
    // Filter out property names that are clearly nested (db, drizzle, zod, etc.)
    if (!['db', 'sqlite', 'column', 'mode', 'zod', 'default', 'tsType'].includes(key)) {
      types.push(key)
    }
  }

  return types.length > 0 ? types : null
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

function main() {
  console.log('🔍 Validating field types sync...\n')

  let hasErrors = false
  const results = {}

  // 1. Extract generator field types (source of truth)
  const generatorTypes = extractManifestFieldTypes()
  if (generatorTypes.length === 0) {
    console.error('❌ Could not extract field types from manifests')
    process.exit(1)
  }

  console.log(`📦 Manifests (source of truth): ${generatorTypes.length} types`)
  console.log(`   Types: ${generatorTypes.join(', ')}\n`)
  results.generator = generatorTypes

  // 2. Check MCP server field types
  const mcpContent = readFileSafe(mcpFieldTypesPath)
  if (mcpContent) {
    const mcpTypes = extractMcpFieldTypes(mcpContent)
    if (mcpTypes) {
      results.mcp = mcpTypes
      if (arrayEquals(generatorTypes, mcpTypes)) {
        console.log(`✅ MCP Server: ${mcpTypes.length} types (matches generator)`)
      } else {
        console.log(`❌ MCP Server: ${mcpTypes.length} types (MISMATCH)`)
        console.log(`   Types: ${mcpTypes.join(', ')}`)

        const missing = generatorTypes.filter(t => !mcpTypes.includes(t))
        const extra = mcpTypes.filter(t => !generatorTypes.includes(t))

        if (missing.length > 0) {
          console.log(`   Missing: ${missing.join(', ')}`)
        }
        if (extra.length > 0) {
          console.log(`   Extra: ${extra.join(', ')}`)
        }
        hasErrors = true
      }
    } else {
      console.log('⚠️  MCP Server: Could not extract field types')
    }
  } else {
    console.log('⚠️  MCP Server: field-types.ts not found')
  }

  // 3. Check skill file field types
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
