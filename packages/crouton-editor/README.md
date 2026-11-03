# Nuxt Crouton Editor

Rich text editor addon layer for Nuxt Crouton, now powered by **Nuxt UI Editor**.

> **v2.0 Breaking Change**: This package now wraps Nuxt UI's `UEditor` component instead of bundling TipTap directly. This provides a more feature-rich, maintained editor with better Nuxt UI integration.

## Features

- **Nuxt UI Editor** - Full-featured rich text editing via Nuxt UI
- **Backwards Compatible** - `CroutonEditorSimple` still works as before
- **New Capabilities** - Access to slash commands, mentions, emoji picker, drag & drop
- **Type-safe** - Full TypeScript support
- **Dark Mode** - Automatic dark mode support via Nuxt UI theming

## Installation

### 1. Install the package

```bash
pnpm add @fyit/crouton-editor
```

### 2. Ensure Nuxt UI is configured

This package requires `@nuxt/ui` v3.4+ to be installed and configured in your project:

```typescript
// nuxt.config.ts
export default defineNuxtConfig({
  modules: ['@nuxt/ui'],
  extends: [
    '@fyit/crouton-core',
    '@fyit/crouton-editor'
  ]
})
```

## Usage

### CroutonEditorSimple (Backwards Compatible)

The simplest way to add a rich text editor:

```vue
<template>
  <CroutonEditorSimple v-model="content" />
</template>

<script setup lang="ts">
const content = ref('<p>Hello world!</p>')
</script>
```

**Props:**
| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `modelValue` | `string` | `''` | HTML/Markdown content (v-model) |
| `placeholder` | `string` | - | Placeholder text |
| `contentType` | `'html' \| 'markdown' \| 'json'` | `'html'` | Content format |
| `starterKit` | `object` | - | TipTap StarterKit options |
| `extensions` | `array` | - | Additional TipTap extensions |
| `editable` | `boolean` | `true` | Enable/disable editing |
| `autofocus` | `boolean \| 'start' \| 'end' \| 'all'` | - | Focus behavior |
| `markdown` | `object` | - | Markdown extension options |
| `image` | `object` | - | Image extension options |
| `mention` | `object` | - | Mention extension options |
| `handlers` | `object` | - | Custom handlers for toolbar/suggestions |
| `ui` | `object` | `{ root: 'h-full', content: 'h-full' }` | Style customization |

**Events:** `@create`, `@update`, `@focus`, `@blur`

**Slot:** `default` with `{ editor, handlers }` for custom toolbars

### Using Nuxt UI Editor Directly (Recommended)

For full control, use Nuxt UI's editor components directly:

```vue
<template>
  <UEditor
    v-slot="{ editor }"
    v-model="content"
    content-type="html"
    placeholder="Write something..."
  >
    <!-- Bubble toolbar on text selection -->
    <UEditorToolbar :editor="editor" :items="toolbarItems" layout="bubble" />

    <!-- Slash commands (type /) -->
    <UEditorSuggestionMenu :editor="editor" :items="slashItems" />

    <!-- Drag handle for block reordering -->
    <UEditorDragHandle :editor="editor" />
  </UEditor>
</template>

<script setup lang="ts">
import type { EditorToolbarItem, EditorSuggestionMenuItem } from '@nuxt/ui'

const content = ref('<p>Hello world!</p>')

const toolbarItems: EditorToolbarItem[][] = [
  [
    { kind: 'mark', mark: 'bold', icon: 'i-lucide-bold' },
    { kind: 'mark', mark: 'italic', icon: 'i-lucide-italic' },
    { kind: 'mark', mark: 'strike', icon: 'i-lucide-strikethrough' }
  ],
  [
    { kind: 'bulletList', icon: 'i-lucide-list' },
    { kind: 'orderedList', icon: 'i-lucide-list-ordered' }
  ]
]

const slashItems: EditorSuggestionMenuItem[][] = [
  [
    { kind: 'heading', level: 1, label: 'Heading 1', icon: 'i-lucide-heading-1' },
    { kind: 'heading', level: 2, label: 'Heading 2', icon: 'i-lucide-heading-2' },
    { kind: 'bulletList', label: 'Bullet List', icon: 'i-lucide-list' }
  ]
]
</script>
```

## Migration from v1.x

### Breaking Changes

1. **Peer dependency**: Requires `@nuxt/ui` v3.4+ instead of `nuxt-tiptap`
2. **Removed**: `CroutonEditorToolbar` - use `UEditorToolbar` directly
3. **Removed**: Direct TipTap dependencies - handled by Nuxt UI

### Migration Steps

1. **Update dependencies**:
   ```bash
   pnpm remove nuxt-tiptap @tiptap/vue-3 @tiptap/starter-kit
   # @nuxt/ui is now included via @fyit/crouton-core
   ```

2. **Update nuxt.config.ts**:
   ```typescript
   export default defineNuxtConfig({
     extends: [
       '@fyit/crouton-core',
       '@fyit/crouton-editor'
     ]
   })
   ```

3. **Component changes**:
   ```vue
   <!-- Before (still works) -->
   <CroutonEditorSimple v-model="content" />

   <!-- After (recommended for full features) -->
   <UEditor v-model="content" content-type="html" />
   ```

4. **Custom toolbar** (if you were using `CroutonEditorToolbar`):
   ```vue
   <!-- Before -->
   <CroutonEditorToolbar :editor="editor" />

   <!-- After -->
   <UEditorToolbar :editor="editor" :items="toolbarItems" layout="bubble" />
   ```

## New Features in v2.0

With Nuxt UI Editor, you now have access to:

- **Slash Commands** - Type `/` for quick formatting
- **Mentions** - Type `@` to mention users
- **Emoji Picker** - Type `:` for emojis
- **Drag & Drop** - Reorder blocks with drag handle
- **Multiple Toolbars** - Fixed, bubble, or floating layouts
- **Markdown Support** - Native markdown content type
- **Custom Extensions** - Easy TipTap extension integration

## Nuxt UI Editor Documentation

For full documentation on all editor features, see:
- [Nuxt UI Editor](https://ui.nuxt.com/docs/components/editor)
- [Editor Toolbar](https://ui.nuxt.com/docs/components/editor-toolbar)
- [Editor Suggestion Menu](https://ui.nuxt.com/docs/components/editor-suggestion-menu)
- [Editor Mention Menu](https://ui.nuxt.com/docs/components/editor-mention-menu)

## Support

For issues, questions, or contributions:
- GitHub: [https://github.com/FriendlyInternet/nuxt-crouton](https://github.com/FriendlyInternet/nuxt-crouton)
- Issues: [https://github.com/FriendlyInternet/nuxt-crouton/issues](https://github.com/FriendlyInternet/nuxt-crouton/issues)

## License

MIT

---

*Part of the Nuxt Crouton ecosystem*
