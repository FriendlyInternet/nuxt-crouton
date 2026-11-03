# CLAUDE.md - @fyit/crouton-editor

## Package Purpose

Rich text editor addon for Nuxt Crouton. Wraps Nuxt UI's `UEditor` (TipTap-based) with full feature parity, Crouton-specific defaults, **variable insertion support**, and **live preview** functionality.

## Key Files

| File | Purpose |
|------|---------|
| `app/components/Simple.vue` | `CroutonEditorSimple` - Full-featured UEditor wrapper |
| `app/components/Blocks.vue` | `CroutonEditorBlocks` - Block editor with property panel support |
| `app/components/Variables.vue` | `CroutonEditorVariables` - Variable insertion menu ({{ trigger) |
| `app/components/Preview.vue` | `CroutonEditorPreview` - Live preview with variable interpolation |
| `app/components/WithPreview.vue` | `CroutonEditorWithPreview` - Editor + preview side-by-side |
| `app/composables/useEditorVariables.ts` | Variable utilities (interpolation, extraction) |
| `app/types/editor.ts` | TypeScript type definitions |
| `nuxt.config.ts` | Layer configuration |

## Components

### CroutonEditorSimple

Full-featured wrapper around Nuxt UI's `UEditor` component.

```vue
<!-- Basic usage -->
<CroutonEditorSimple
  v-model="content"
  placeholder="Start writing..."
/>

<!-- With content type -->
<CroutonEditorSimple
  v-model="content"
  content-type="markdown"
/>

<!-- With custom toolbar via slot -->
<CroutonEditorSimple v-model="content">
  <template #default="{ editor, handlers }">
    <UEditorToolbar :editor="editor" :handlers="handlers" />
  </template>
</CroutonEditorSimple>
```

**Props:**

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `modelValue` | `string \| null` | `''` | Content (v-model) |
| `placeholder` | `string` | - | Placeholder text |
| `contentType` | `'html' \| 'markdown' \| 'json'` | `'html'` | Output format |
| `starterKit` | `object` | - | TipTap StarterKit options |
| `extensions` | `array` | - | Additional TipTap extensions |
| `editable` | `boolean` | `true` | Enable/disable editing |
| `autofocus` | `boolean \| 'start' \| 'end' \| 'all' \| number` | - | Focus behavior |
| `markdown` | `object` | - | Markdown extension options |
| `image` | `object` | - | Image extension options |
| `mention` | `object` | - | Mention extension options |
| `handlers` | `object` | - | Custom handlers |
| `ui` | `object` | `{ root: 'h-full', content: 'h-full' }` | Style customization |
| `enableTranslationAI` | `boolean` | `false` | Enable AI translation button |
| `translationContext` | `TranslationContext` | - | Context for AI translation |
| `onTranslationAccept` | `(text: string) => void` | - | Callback when translation is accepted |
| `enableImageUpload` | `boolean` | `false` | Enable image upload (toolbar button, paste, drag-drop) |

**Image Upload:**

```vue
<CroutonEditorSimple
  v-model="content"
  enable-image-upload
/>
```

When `enableImageUpload` is `true`:
- Toolbar shows an "Insert Image" button
- Paste handler: intercepts pasted images, uploads via `/api/upload-image`, inserts `<img>`
- Drop handler: intercepts dropped image files, uploads and inserts
- Upload indicator shown in toolbar during upload

**AI Translation:**

```vue
<CroutonEditorSimple
  v-model="content"
  enable-translation-ai
  :translation-context="{
    sourceText: selectedText,
    sourceLanguage: 'en',
    targetLanguage: 'nl',
    fieldType: 'description'
  }"
  @translation-accept="handleTranslation"
/>
```

### CroutonEditorBlocks

Block-based editor with support for custom NodeView blocks and property panel editing.
Built on CroutonEditorSimple, designed for structured page content.

```vue
<CroutonEditorBlocks
  v-model="content"
  :extensions="[MyBlockExtension]"
  content-type="json"
  placeholder="Type / to insert a block..."
>
  <!-- Custom property panel via slot -->
  <template #property-panel="{ selectedNode, isOpen, close, updateAttrs, deleteBlock }">
    <USlideover :model-value="isOpen" @update:model-value="!$event && close()">
      <template #content>
        <MyPropertyPanel
          v-if="selectedNode"
          :node="selectedNode.node"
          @update="updateAttrs"
          @delete="deleteBlock"
          @close="close"
        />
      </template>
    </USlideover>
  </template>
</CroutonEditorBlocks>
```

**Props:**

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `modelValue` | `string \| null` | `''` | Content (v-model) |
| `placeholder` | `string` | - | Placeholder text |
| `contentType` | `'html' \| 'markdown' \| 'json'` | `'json'` | Output format |
| `editable` | `boolean` | `true` | Enable/disable editing |
| `extensions` | `array` | - | Custom TipTap block extensions |
| `showToolbar` | `boolean` | `true` | Show the toolbar |
| `showBubbleToolbar` | `boolean` | `false` | Show bubble toolbar on selection |

**Events:**

| Event | Payload | Description |
|-------|---------|-------------|
| `update:modelValue` | `string` | Content changed |
| `create` | `{ editor: Editor }` | Editor instance created |
| `update` | `{ editor: Editor }` | Content updated |
| `block:select` | `{ node, pos } \| null` | Block selected/deselected |
| `block:edit` | `{ node, pos }` | Block edit requested |

**Slot Props (property-panel):**

| Prop | Type | Description |
|------|------|-------------|
| `selectedNode` | `{ node, pos } \| null` | Currently selected block |
| `isOpen` | `boolean` | Property panel open state |
| `close` | `() => void` | Close the panel |
| `updateAttrs` | `(attrs) => void` | Update block attributes |
| `deleteBlock` | `() => void` | Delete selected block |

**NodeView Block Communication:**

NodeView components (rendered via VueNodeViewRenderer) can request the property panel
to open by dispatching a custom DOM event:

```typescript
// In your block's NodeView component
function handleOpenPanel() {
  const event = new CustomEvent('block-edit-request', {
    bubbles: true,
    detail: { node: props.node, pos: props.getPos() }
  })
  document.dispatchEvent(event)
}
```

When `enableTranslationAI` is `true`, a sparkles button appears in the toolbar. Clicking it (or pressing `⌘J`) translates the selected text using the AI translation API.

### CroutonEditorVariables

Variable insertion menu using TipTap's mention system. Triggered by typing `{{`.

```vue
<CroutonEditorSimple v-model="content">
  <template #default="{ editor }">
    <CroutonEditorVariables
      :editor="editor"
      :variables="emailVariables"
    />
  </template>
</CroutonEditorSimple>

<script setup>
const emailVariables = [
  { name: 'customer_name', label: 'Customer Name', sample: 'John Doe' },
  { name: 'booking_date', label: 'Booking Date', sample: 'January 15, 2024' },
]
</script>
```

**Props:**

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `editor` | `Editor` | - | TipTap editor instance (from slot) |
| `variables` | `EditorVariable[]` | `[]` | Variables to show in menu |
| `groups` | `EditorVariableGroup[]` | - | Grouped variables (alternative) |
| `char` | `string` | `'{{'` | Trigger character |

### CroutonEditorPreview

Live preview component with variable interpolation.

```vue
<CroutonEditorPreview
  :content="emailBody"
  :variables="emailVariables"
  :values="{ customer_name: 'Jane Smith' }"
  title="Email Preview"
/>
```

**Props:**

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `content` | `string \| Record<string, any>` | - | Raw HTML content with `{{variables}}`, or TipTap JSON document |
| `title` | `string` | `'Preview'` | Panel title |
| `values` | `Record<string, string>` | - | Values for interpolation |
| `variables` | `EditorVariable[]` | - | Variable definitions (for samples) |
| `mode` | `'inline' \| 'panel'` | `'panel'` | Display mode |
| `expandable` | `boolean` | `true` | Allow expanding to modal |
| `showVariableCount` | `boolean` | `true` | Show variable count in header |

### CroutonEditorWithPreview

Combined editor and preview with responsive layout:
- **Desktop**: Side-by-side columns
- **Mobile**: Tab switching between Editor and Preview

```vue
<CroutonEditorWithPreview
  v-model="emailBody"
  :variables="emailVariables"
  :preview-values="sampleData"
  preview-title="Email Preview"
  placeholder="Write your email template..."
/>

<script setup>
const emailVariables = [
  { name: 'customer_name', label: 'Customer Name', category: 'customer', sample: 'John Doe' },
  { name: 'booking_date', label: 'Booking Date', category: 'booking', sample: 'Monday, January 15, 2024' },
  { name: 'location_name', label: 'Location', category: 'location', sample: 'Main Office' },
]

const sampleData = {
  customer_name: 'Jane Smith',
  booking_date: 'Tuesday, January 16, 2024',
  location_name: 'Downtown Branch'
}
</script>
```

**Props:**

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `modelValue` | `string \| null` | `''` | Content (v-model) |
| `variables` | `EditorVariable[]` | `[]` | Variables for insertion |
| `previewValues` | `Record<string, string>` | - | Override sample values |
| `previewTitle` | `string` | `'Preview'` | Preview panel title |
| `contentType` | `'html' \| 'markdown' \| 'json'` | `'html'` | Output format |
| `placeholder` | `string` | - | Placeholder text |
| `editable` | `boolean` | `true` | Enable/disable editing |
| `showVariableChips` | `boolean` | `true` | Show quick-insert chips |
| `extensions` | `array` | - | Additional TipTap extensions |

## Composables

### useEditorVariables

Utilities for working with editor variables.

```typescript
const {
  toMentionItems,      // Convert variables to menu format
  interpolate,         // Replace {{vars}} with values
  extractVariables,    // Get variable names from content
  getSampleValues,     // Get samples from variable definitions
  findUndefinedVariables,  // Find vars used but not defined
  highlightVariables   // Wrap vars in styled spans
} = useEditorVariables()

// Example: Interpolate content
const rendered = interpolate(
  'Hello {{customer_name}}!',
  { customer_name: 'John' }
)
// Result: "Hello John!"

// Example: Extract variables
const vars = extractVariables('Hello {{name}}, your booking is on {{date}}')
// Result: ['name', 'date']
```

## Types

```typescript
import type { EditorVariable, EditorVariableGroup } from '#crouton-editor/types/editor'

interface EditorVariable {
  name: string        // Variable name: "customer_name"
  label: string       // Display label: "Customer Name"
  description?: string // Help text
  icon?: string       // Lucide icon
  category?: string   // Grouping: "customer", "booking"
  sample?: string     // Sample value for preview
}

interface EditorVariableGroup {
  label: string
  variables: EditorVariable[]
}
```

## Features (via Nuxt UI)

- Slash commands (`/`)
- Mentions (`@`)
- Emoji picker (`:`)
- **Variables (`{{`)** - NEW
- Drag & drop blocks
- Multiple toolbar layouts (fixed, bubble, floating)
- Markdown native support
- Image handling
- **Image upload** (toolbar, paste, drag-drop) via `enableImageUpload` prop
- Code blocks with syntax highlighting
- **Live preview with interpolation** - NEW

## Configuration

```typescript
// nuxt.config.ts
export default defineNuxtConfig({
  modules: ['@nuxt/ui'],  // Required (v3.4.0+)
  extends: [
    '@fyit/crouton-core',
    '@fyit/crouton-editor'
  ]
})
```

## Component Naming

Components auto-import with `CroutonEditor` prefix:
- `Simple.vue` → `<CroutonEditorSimple />`
- `Variables.vue` → `<CroutonEditorVariables />`
- `Preview.vue` → `<CroutonEditorPreview />`
- `WithPreview.vue` → `<CroutonEditorWithPreview />`

## Common Tasks

### Add variables to editor

```vue
<CroutonEditorSimple v-model="content">
  <template #default="{ editor }">
    <CroutonEditorVariables :editor="editor" :variables="myVariables" />
  </template>
</CroutonEditorSimple>
```

### Editor with live preview

```vue
<CroutonEditorWithPreview
  v-model="content"
  :variables="myVariables"
  preview-title="Preview"
/>
```

### Custom variable trigger

```vue
<CroutonEditorVariables
  :editor="editor"
  :variables="variables"
  char="#"
/>
```

### Group variables by category

Variables with `category` prop are automatically grouped:

```typescript
const variables = [
  { name: 'user_name', label: 'User Name', category: 'user' },
  { name: 'user_email', label: 'User Email', category: 'user' },
  { name: 'order_id', label: 'Order ID', category: 'order' },
]
// Renders with "User" and "Order" group headers
```

### Preview with custom values

```vue
<CroutonEditorPreview
  :content="template"
  :variables="variables"
  :values="{ customer_name: 'Test User' }"
/>
```

### Read-only mode

```vue
<CroutonEditorWithPreview
  v-model="content"
  :editable="false"
  :variables="variables"
/>
```

## Dependencies

- **Extends**: `@fyit/crouton-core`
- **Requires**: `@nuxt/ui ^3.4.0` (provides TipTap integration)
- **Peer deps**: `@nuxt/icon ^1.0.0`

## Documentation

- [Nuxt UI Editor](https://ui.nuxt.com/docs/components/editor)
- [Editor Mention Menu](https://ui.nuxt.com/docs/components/editor-mention-menu)
- [TipTap Mention Extension](https://tiptap.dev/docs/editor/extensions/nodes/mention)

## Testing

```bash
npx nuxt typecheck  # MANDATORY after changes
```
