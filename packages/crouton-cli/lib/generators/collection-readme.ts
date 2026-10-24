// Generator for the collection-level README.md.
//
// Short on purpose: it orients whoever opens the folder and states the lifecycle
// (generate once, then the app owns the files — #2278). The API/usage walkthrough
// it used to carry duplicated crouton-core's docs and drifted; it's gone.

import { metadataFields } from '../utils/system-fields.ts'

export function generateCollectionReadme(data: Record<string, any>, config: Record<string, any> = {}): string {
  const {
    singular,
    plural,
    pascalCasePlural,
    layerPascalCase,
    layer,
    fields,
    hierarchy
  } = data

  // Use layerCamelCase if available, fallback to layerPascalCase.toLowerCase() for backwards compatibility
  const layerCamelCase = data.layerCamelCase || layerPascalCase.toLowerCase()
  const prefixedPascalCasePlural = `${layerPascalCase}${pascalCasePlural}`
  const prefixedCamelCasePlural = `${layerCamelCase}${pascalCasePlural}`
  const apiPath = `${layer}-${plural}`
  const generatedDate = new Date().toISOString().split('T')[0]

  const fieldRows = fields
    .filter(f => f.name !== 'id')
    .map((field) => {
      const required = field.meta?.required ? 'Yes' : 'No'
      const refInfo = field.refTarget ? ` (→ ${field.refTarget})` : ''
      return `| ${field.name} | ${field.type}${refInfo} | ${required} |`
    })
    .join('\n')

  const systemRows = metadataFields(config?.flags?.useMetadata !== false)
    .map(name => `| ${name} | ${name.endsWith('At') ? 'timestamp' : 'string'} | Auto |`)
    .join('\n')

  const hasHierarchy = hierarchy?.enabled === true
  const translatableFields: string[] = config?.translations?.collections?.[plural] || []
  const referenceFields = fields.filter(f => f.refTarget)

  const notes: string[] = []
  if (hasHierarchy) notes.push('- Tree collection: items have a parent, a path and an order.')
  if (translatableFields.length) notes.push(`- Translated fields: ${translatableFields.join(', ')}`)
  if (referenceFields.length) notes.push(`- References: ${referenceFields.map(f => `${f.name} → ${f.refTarget}`).join(', ')}`)
  const notesSection = notes.length ? `\n${notes.join('\n')}\n` : ''

  const apiFiles = [
    'index.get.ts / index.post.ts',
    `[${singular}Id].patch.ts / [${singular}Id].delete.ts`,
    ...(hasHierarchy ? [`[${singular}Id]/move.patch.ts`, 'reorder.patch.ts'] : [])
  ]
  const apiTree = apiFiles
    .map((f, i) => `│   ${i === apiFiles.length - 1 ? '└──' : '├──'} ${f}`)
    .join('\n')

  return `# ${prefixedPascalCasePlural}

> Generated once by @fyit/crouton-cli on ${generatedDate}. From here on it's yours:
> edit any file in this folder. \`crouton config\` skips files that already exist;
> only \`--force\` overwrites them.

| | |
|---|---|
| Collection | \`${prefixedCamelCasePlural}\` |
| API | \`/api/teams/[teamId]/${apiPath}\` |
| Components | \`<${prefixedPascalCasePlural}Form />\`, \`<${prefixedPascalCasePlural}List />\` |
| Composable | \`use${prefixedPascalCasePlural}()\` |
${notesSection}
## Fields

| Field | Type | Required |
|-------|------|----------|
| id | string (primary key) | Auto |
${fieldRows}
${systemRows}

## Files

\`\`\`
collections/${plural}/
├── app/components/Form.vue            # the form
├── app/components/List.vue            # the table
├── app/composables/use${prefixedPascalCasePlural}.ts   # Zod schema, columns, config
├── server/api/teams/[id]/${apiPath}/
${apiTree}
├── server/database/schema.ts          # Drizzle table
├── server/database/queries.ts         # DB access
├── types.ts
└── nuxt.config.ts
\`\`\`

To add a field: edit the schema, the composable and the form, or regenerate with \`--force\`
and re-apply your edits. How the pieces fit is documented in @fyit/crouton-core.
`
}
