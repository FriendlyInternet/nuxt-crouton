import { ALLOWED_META_KEYS } from '@fyit/crouton-cli/lib/utils/load-fields.ts'

/**
 * Field Types Reference Resource
 * Synced with: packages/nuxt-crouton-cli/lib/utils/helpers.mjs
 * Allowed meta keys: packages/crouton-cli/lib/utils/load-fields.ts (ALLOWED_META_KEYS, #3165)
 */
export default defineMcpResource({
  uri: 'crouton://field-types',
  name: 'Crouton Field Types Reference',
  description: 'Complete reference of all available field types in Crouton schemas (synced with generator)',
  mimeType: 'text/markdown',
  async handler() {
    return {
      contents: [{
        uri: 'crouton://field-types',
        mimeType: 'text/markdown',
        text: `# Crouton Field Types Reference

> **Source of truth**: \`packages/nuxt-crouton-cli/lib/utils/helpers.mjs\`

## Core Field Types

| Type | Zod Validation | TypeScript | DB (Drizzle) | Default |
|------|----------------|------------|--------------|---------|
| \`string\` | \`z.string()\` | \`string\` | \`text\` | \`''\` |
| \`text\` | \`z.string()\` | \`string\` | \`text\` | \`''\` |
| \`number\` | \`z.number()\` | \`number\` | \`integer\` | \`0\` |
| \`decimal\` | \`z.number()\` | \`number\` | \`decimal\` | \`0\` |
| \`boolean\` | \`z.boolean()\` | \`boolean\` | \`boolean\` | \`false\` |
| \`date\` | \`z.date()\` | \`Date \\| null\` | \`timestamp\` | \`null\` |
| \`json\` | \`z.record(z.string(), z.any())\` | \`Record<string, any>\` | \`json\` | \`{}\` |
| \`repeater\` | \`z.array(z.any())\` | \`any[]\` | \`json\` | \`[]\` |
| \`array\` | \`z.array(z.string())\` | \`string[]\` | \`text\` | \`[]\` |

## Schema Format

### Basic Field
\`\`\`json
{
  "fieldName": {
    "type": "string",
    "meta": {
      "required": true,
      "maxLength": 255,
      "label": "Field Label",
      "help": "Help text for the field"
    }
  }
}
\`\`\`

### Field with Reference (Relation)
\`\`\`json
{
  "categoryId": {
    "type": "string",
    "refTarget": "categories",
    "meta": {
      "required": true,
      "label": "Category"
    }
  }
}
\`\`\`

### Dropdown Field (Inline Options)
\`\`\`json
{
  "status": {
    "type": "string",
    "meta": {
      "displayAs": "optionsSelect",
      "options": ["draft", "published", "archived"]
    }
  }
}
\`\`\`

### Decimal Field
\`\`\`json
{
  "price": {
    "type": "decimal",
    "meta": {
      "precision": 10,
      "scale": 2,
      "required": true
    }
  }
}
\`\`\`

### Repeater Field (Nested Items)
\`\`\`json
{
  "items": {
    "type": "repeater",
    "meta": {
      "properties": {
        "name": { "type": "string", "required": true },
        "quantity": { "type": "number", "default": 1 }
      }
    }
  }
}
\`\`\`

## Meta Options

A field takes only \`type\`, \`meta\`, \`refTarget\` and \`refScope\`; every option goes under \`meta\`. The generator refuses any other key.

| Option | Type | Description |
|--------|------|-------------|
| \`required\` | boolean | Field is required |
| \`nullable\` | boolean | Column may be null |
| \`unique\` | boolean | Enforce uniqueness |
| \`default\` | any | Default value |
| \`maxLength\` | number | Max string length |
| \`min\` / \`max\` | number | Numeric bounds |
| \`precision\` / \`scale\` | number | Decimal precision and scale |
| \`label\` | string | Display label |
| \`description\` / \`help\` | string | Help text |
| \`area\` / \`group\` | string | Form placement |
| \`sortable\` | boolean | Enable sorting in the list |
| \`readOnly\` | boolean | Read-only — **reference fields only** (needs \`refTarget\`) |
| \`options\` | string[] | Dropdown choices — needs \`displayAs: "optionsSelect"\`, otherwise a plain text input |
| \`displayAs\` | string | \`"optionsSelect"\` renders \`options\` / \`optionsCollection\` as a dropdown |
| \`properties\` | object | Repeater item fields |

**Every allowed meta key** (read from the generator): ${[...ALLOWED_META_KEYS].map(k => `\`${k}\``).join(', ')}

## Auto-Generated Fields

These fields are automatically added to every collection:

| Field | Type | Purpose |
|-------|------|---------|
| \`id\` | string | Primary key (uuid/nanoid) |
| \`teamId\` | string | Team association |
| \`createdAt\` | date | Creation timestamp |
| \`updatedAt\` | date | Last update timestamp |
| \`createdBy\` | string | Creator user ID |
| \`updatedBy\` | string | Last updater user ID |

With \`--hierarchy\` flag:
| Field | Type | Purpose |
|-------|------|---------|
| \`parentId\` | string | Parent item ID |
| \`path\` | string | Materialized path |
| \`depth\` | number | Tree depth |
| \`order\` | number | Sort order |

## Complete Example Schema

\`\`\`json
{
  "name": {
    "type": "string",
    "meta": {
      "required": true,
      "maxLength": 255,
      "label": "Product Name",
      "sortable": true
    }
  },
  "description": {
    "type": "text",
    "meta": {
      "label": "Description"
    }
  },
  "price": {
    "type": "decimal",
    "meta": {
      "required": true,
      "precision": 10,
      "scale": 2,
      "min": 0,
      "sortable": true
    }
  },
  "inStock": {
    "type": "boolean",
    "meta": {
      "default": true,
      "label": "In Stock"
    }
  },
  "categoryId": {
    "type": "string",
    "refTarget": "categories",
    "meta": {
      "required": true,
      "label": "Category"
    }
  },
  "tags": {
    "type": "array",
    "meta": {
      "label": "Tags"
    }
  },
  "metadata": {
    "type": "json",
    "meta": {
      "label": "Additional Data",
      "default": {}
    }
  }
}
\`\`\`
`
      }]
    }
  }
})
