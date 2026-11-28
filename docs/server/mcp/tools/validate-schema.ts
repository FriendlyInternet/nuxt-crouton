import { z } from 'zod'
import { checkCroutonSchema } from '../../utils/check-crouton-schema'

export default defineMcpTool({
  name: 'validate_schema',
  description: 'Validate a Crouton collection schema against the keys the generator actually reads. Returns validation errors (each naming its fix) if any, or confirms the schema is valid.',
  inputSchema: {
    schema: z.string().describe('JSON string of the schema to validate')
  },
  async handler({ schema }) {
    // Parse JSON
    let parsedSchema: Record<string, any>
    try {
      parsedSchema = JSON.parse(schema)
    } catch {
      return {
        content: [{
          type: 'text' as const,
          text: `❌ **Invalid JSON**: Could not parse the schema. Please ensure it's valid JSON.\n\nError: Invalid JSON syntax`
        }]
      }
    }

    // Check if it's an object
    if (typeof parsedSchema !== 'object' || parsedSchema === null || Array.isArray(parsedSchema)) {
      return {
        content: [{
          type: 'text' as const,
          text: '❌ **Invalid Schema**: Schema must be an object with field definitions.'
        }]
      }
    }

    // Validate each field against the generator's own key lists (#3165)
    const { errors, warnings } = checkCroutonSchema(parsedSchema)

    // Generate response
    if (errors.length === 0 && warnings.length === 0) {
      return {
        content: [{
          type: 'text' as const,
          text: `✅ **Schema is valid!**

**Fields defined**: ${Object.keys(parsedSchema).length}

Fields:
${Object.entries(parsedSchema).map(([name, def]) => {
  const d = def as Record<string, any>
  return `- \`${name}\`: ${d.type}${d.refTarget ? ` → ${d.refTarget}` : ''}${d.meta?.required ? ' (required)' : ''}`
}).join('\n')}

The schema is ready for generation with:
\`\`\`bash
crouton <layer> <collection> --fields-file=schema.json
\`\`\``
        }]
      }
    }

    let response = ''
    if (errors.length > 0) {
      response += `❌ **Validation Errors** (${errors.length}):\n\n${errors.map(e => `- ${e}`).join('\n')}\n\n`
    }
    if (warnings.length > 0) {
      response += `⚠️ **Warnings** (${warnings.length}):\n\n${warnings.map(w => `- ${w}`).join('\n')}\n\n`
    }

    response += `\n**Reference**: Allowed keys come from the generator (crouton-cli \`lib/utils/load-fields.ts\`); see the \`crouton://field-types\` resource.`

    return {
      content: [{
        type: 'text' as const,
        text: response
      }]
    }
  }
})
