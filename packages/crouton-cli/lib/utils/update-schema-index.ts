// Update server/db/schema.ts — add/remove schema exports using magicast
// Replaces regex-based export detection and string append

import { readFile, writeFile, access, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { parseModule, generateCode } from 'magicast'

// Default content for new schema index files
const DEFAULT_SCHEMA_CONTENT = `// Database schema exports
// This file is auto-managed by crouton-generate

// Export auth schema from crouton-auth package
export * from '@fyit/crouton-auth/server/database/schema/auth'
`

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

/**
 * Find re-export declarations in the AST that match a given source path pattern.
 */
function findExportBySource(mod: any, pattern: string): any {
  // magicast's $ast may be a File (has .program) or the Program node itself
  // (has .body). Falling back to mod.$ast.body grabbed the statements ARRAY, whose
  // .body is undefined → the loop saw an empty list and never matched (#1445 WS4).
  const program = mod.$ast.program || mod.$ast
  const body = program?.body || []
  for (const node of body) {
    if (
      (node.type === 'ExportNamedDeclaration' || node.type === 'ExportAllDeclaration')
      && node.source?.value
      && String(node.source.value).includes(pattern)
    ) {
      return node
    }
  }
  return null
}

/**
 * Find a named re-export by export name.
 */
function findExportByName(mod: any, exportName: string): any {
  const program = mod.$ast.program || mod.$ast
  const body = program?.body || []
  for (const node of body) {
    if (node.type === 'ExportNamedDeclaration' && node.specifiers) {
      for (const spec of node.specifiers) {
        if (
          spec.type === 'ExportSpecifier'
          && (spec.exported?.name === exportName || spec.local?.name === exportName)
        ) {
          return node
        }
      }
    }
  }
  return null
}

/**
 * Add a wildcard re-export: `export * from 'path'`
 * Used by `crouton add` to wire up module schemas.
 */
export async function addSchemaExport(schemaPath: string, exportPath: string): Promise<{ added: boolean; reason?: string; created?: boolean }> {
  const fileExist = await pathExists(schemaPath)

  let content: string
  let created = false

  if (!fileExist) {
    await mkdir(dirname(schemaPath), { recursive: true })
    content = DEFAULT_SCHEMA_CONTENT
    created = true
  } else {
    content = await readFile(schemaPath, 'utf-8')
  }

  // Check if already exists
  if (content.includes(exportPath)) {
    return { added: false, reason: 'already exported' }
  }

  // Append the export line
  content = content.trimEnd() + '\n' + `export * from '${exportPath}'` + '\n'

  await writeFile(schemaPath, content, 'utf-8')
  return { added: true, created }
}

/**
 * Add a named re-export: `export { Name } from 'path'`
 * Used by `crouton generate` for collection schemas.
 */
export async function addNamedSchemaExport(schemaPath: string, exportName: string, importPath: string, force = false): Promise<{ added: boolean; reason?: string; created?: boolean }> {
  const fileExist = await pathExists(schemaPath)

  let content: string
  let created = false

  if (!fileExist) {
    await mkdir(dirname(schemaPath), { recursive: true })
    content = DEFAULT_SCHEMA_CONTENT
    created = true
  } else {
    content = await readFile(schemaPath, 'utf-8')
  }

  // Fast path: if this exact import path is already present, never append regardless of force
  if (content.includes(`from '${importPath}'`) || content.includes(`from "${importPath}"`)) {
    return { added: false, reason: 'already exported' }
  }

  try {
    const mod = parseModule(content)

    // Check for conflicting export (same name from different source)
    const existingByName = findExportByName(mod, exportName)
    if (existingByName && !force) {
      const existingSource = existingByName.source?.value || 'unknown'
      if (!String(existingSource).includes(importPath.split('/collections/')[1] || importPath)) {
        return {
          added: false,
          reason: `conflicting export "${exportName}" from "${existingSource}"`,
        }
      }
    }

    // Check if exact export already exists
    const existingBySource = findExportBySource(mod, importPath)
    if (existingBySource) {
      return { added: false, reason: 'already exported' }
    }

    // Append the named export line
    content = content.trimEnd() + '\n' + `export { ${exportName} } from '${importPath}'` + '\n'

    await writeFile(schemaPath, content, 'utf-8')
    return { added: true, created }
  } catch {
    // Fallback: simple string append if AST parsing fails
    content = content.trimEnd() + '\n' + `export { ${exportName} } from '${importPath}'` + '\n'
    await writeFile(schemaPath, content, 'utf-8')
    return { added: true, created }
  }
}

/**
 * Remove a schema export matching a pattern.
 * Used by rollback to clean up schema index.
 */
export async function removeSchemaExport(schemaPath: string, pattern: string): Promise<{ removed: boolean; reason?: string }> {
  if (!await pathExists(schemaPath)) {
    return { removed: false, reason: 'schema index not found' }
  }

  const content = await readFile(schemaPath, 'utf-8')

  if (!content.includes(pattern)) {
    return { removed: false, reason: 'export not found' }
  }

  try {
    const mod = parseModule(content)
    const node = findExportBySource(mod, pattern) || findExportByName(mod, pattern)

    if (!node) {
      return { removed: false, reason: 'export not found in AST' }
    }

    // Remove the node from the program body
    const body = mod.$ast.program?.body || mod.$ast.body || []
    const index = body.indexOf(node)
    if (index !== -1) {
      body.splice(index, 1)
    }

    const result = generateCode(mod)
    await writeFile(schemaPath, result.code, 'utf-8')
    return { removed: true }
  } catch {
    // Fallback: line-based removal
    const lines = content.split('\n')
    const filtered = lines.filter((line: string) => !line.includes(pattern))
    await writeFile(schemaPath, filtered.join('\n'), 'utf-8')
    return { removed: true }
  }
}

/**
 * Check if a schema export already exists.
 */
export async function hasSchemaExport(schemaPath: string, exportPath: string): Promise<boolean> {
  if (!await pathExists(schemaPath)) {
    return false
  }
  const content = await readFile(schemaPath, 'utf-8')
  return content.includes(exportPath)
}

/**
 * Get the schema index path, checking common locations.
 */
export async function getSchemaPath(cwd = process.cwd()): Promise<string> {
  const locations = [
    'server/db/schema.ts',
    'server/database/schema.ts',
    'server/database/schema/index.ts',
  ]

  for (const loc of locations) {
    const fullPath = `${cwd}/${loc}`
    if (await pathExists(fullPath)) {
      return fullPath
    }
  }

  return `${cwd}/${locations[0]}`
}
