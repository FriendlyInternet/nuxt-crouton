import { z } from 'zod'
import { EXAMPLE_SCHEMAS as EXAMPLES } from '../../utils/example-schemas'

export default defineMcpTool({
  name: 'get_example_schema',
  description: 'Get an example Crouton schema for common use cases. Available examples: products, tasks, blog, invoices, events',
  inputSchema: {
    example: z.string().describe('The example to get: products, tasks, blog, invoices, events, or "list" to see all available')
  },
  async handler({ example }) {
    if (example === 'list') {
      const list = Object.entries(EXAMPLES)
        .map(([name, { description }]) => `- **${name}**: ${description}`)
        .join('\n')

      return {
        content: [{
          type: 'text' as const,
          text: `# Available Example Schemas\n\n${list}\n\nUse \`get_example_schema\` with any of these names to get the full schema.`
        }]
      }
    }

    const exampleData = EXAMPLES[example.toLowerCase()]
    if (!exampleData) {
      return {
        content: [{
          type: 'text' as const,
          text: `❌ Example "${example}" not found.\n\nAvailable examples: ${Object.keys(EXAMPLES).join(', ')}\n\nUse "list" to see descriptions.`
        }]
      }
    }

    return {
      content: [{
        type: 'text' as const,
        text: `# ${example.charAt(0).toUpperCase() + example.slice(1)} Schema

**Description**: ${exampleData.description}

## Schema JSON

\`\`\`json
${JSON.stringify(exampleData.schema, null, 2)}
\`\`\`

## Usage

Save this to a file (e.g., \`${example}.json\`) and generate:

\`\`\`bash
crouton <layer> ${example} --fields-file=${example}.json
\`\`\`

## Fields Summary

${Object.entries(exampleData.schema).map(([name, def]) => {
  const d = def as Record<string, any>
  const ref = d.refTarget ? ` → ${d.refTarget}` : ''
  const required = d.meta?.required ? ' *(required)*' : ''
  return `- **${name}**: \`${d.type}\`${ref}${required}`
}).join('\n')}`
      }]
    }
  }
})
