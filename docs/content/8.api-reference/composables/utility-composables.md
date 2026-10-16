---
title: Utility Composables
description: Specialized helpers for translations, assets, formatting, and more
icon: i-lucide-wrench
---

::callout{type="tip" icon="i-lucide-book-open"}
**Query Examples**: For complete `useCollectionQuery` patterns (basic, filtering, pagination, sorting, relations), see [Querying Data](/fundamentals/querying).
::

## useFormatCollections

Format collection names for display with intelligent pluralization and layer prefix handling. **(Already partially documented above, but here's the expanded version)**

### Type Signature

```typescript
function useFormatCollections(): {
  collectionWithCapital: (val: string) => string
  collectionWithCapitalSingular: (val: string) => string
  stripLayerPrefix: (val: string) => string
  camelToTitleCase: (val: string) => string
  toPascalCase: (val: string) => string
}
```

### Returns

- **collectionWithCapital** - Format collection name to Title Case (plural)
- **collectionWithCapitalSingular** - Format collection name to singular Title Case
- **stripLayerPrefix** - Remove layer prefix from collection name
- **camelToTitleCase** - Convert camelCase to Title Case with spaces
- **toPascalCase** - Convert to PascalCase

### Basic Usage

```vue
<script setup lang="ts">
const { collectionWithCapitalSingular } = useFormatCollections()

// Format collection names
console.log(collectionWithCapitalSingular('shopProducts'))   // 'Product'
console.log(collectionWithCapitalSingular('blogPosts'))      // 'Post'
console.log(collectionWithCapitalSingular('adminUsers'))     // 'User'
console.log(collectionWithCapitalSingular('shopCategories')) // 'Category'
</script>
```

### Pluralization Rules

The composable handles various English pluralization patterns:

```vue
<script setup lang="ts">
const { collectionWithCapitalSingular } = useFormatCollections()

// Standard -s removal
collectionWithCapitalSingular('products')    // 'Product'
collectionWithCapitalSingular('users')       // 'User'

// -ies → -y
collectionWithCapitalSingular('categories')  // 'Category'
collectionWithCapitalSingular('companies')   // 'Company'

// Sibilants: -xes, -ches, -shes, -sses, -zes → remove -es
collectionWithCapitalSingular('boxes')       // 'Box'
collectionWithCapitalSingular('watches')     // 'Watch'
collectionWithCapitalSingular('brushes')     // 'Brush'
collectionWithCapitalSingular('classes')     // 'Class'

// -oes → -o (conditional)
collectionWithCapitalSingular('heroes')      // 'Hero'
collectionWithCapitalSingular('tomatoes')    // 'Tomato'
</script>
```

### Layer Prefix Stripping

Automatically removes layer prefixes based on `app.config.ts` registry:

```typescript
// app.config.ts
export default defineAppConfig({
  croutonCollections: {
    shopProducts: { name: 'shopProducts', layer: 'shop' },
    shopCategories: { name: 'shopCategories', layer: 'shop' },
    blogPosts: { name: 'blogPosts', layer: 'blog' },
    adminUsers: { name: 'adminUsers', layer: 'admin' }
  }
})
```

```vue
<script setup lang="ts">
const { stripLayerPrefix, collectionWithCapitalSingular } = useFormatCollections()

// Strip layer prefix
stripLayerPrefix('shopProducts')    // 'products'
stripLayerPrefix('blogPosts')       // 'posts'
stripLayerPrefix('adminUsers')      // 'users'

// Combined with singularization
collectionWithCapitalSingular('shopProducts')    // 'Product' (not 'Shop Product')
collectionWithCapitalSingular('blogPosts')       // 'Post' (not 'Blog Post')
collectionWithCapitalSingular('adminUsers')      // 'User' (not 'Admin User')
</script>
```

### Title Case Conversion

```vue
<script setup lang="ts">
const { camelToTitleCase } = useFormatCollections()

// Convert camelCase to Title Case with spaces
camelToTitleCase('shopProducts')      // 'Shop Products'
camelToTitleCase('userPreferences')   // 'User Preferences'
camelToTitleCase('apiKeys')           // 'Api Keys'
camelToTitleCase('blogPostComments')  // 'Blog Post Comments'
</script>
```

### PascalCase Conversion

```vue
<script setup lang="ts">
const { toPascalCase } = useFormatCollections()

// Convert to PascalCase
toPascalCase('shopProducts')    // 'ShopProducts'
toPascalCase('userSettings')    // 'UserSettings'
toPascalCase('blogPosts')       // 'BlogPosts'
</script>
```

### Plural vs Singular

```vue
<script setup lang="ts">
const {
  collectionWithCapital,          // Plural
  collectionWithCapitalSingular   // Singular
} = useFormatCollections()

const collection = 'shopProducts'

// Plural form (for lists, tables)
collectionWithCapital(collection)         // 'Products'

// Singular form (for buttons, forms)
collectionWithCapitalSingular(collection) // 'Product'
</script>

<template>
  <!-- List heading -->
  <h1>{{ collectionWithCapital('shopProducts') }}</h1>
  <!-- "Products" -->
  
  <!-- Create button -->
  <UButton>Create {{ collectionWithCapitalSingular('shopProducts') }}</UButton>
  <!-- "Create Product" -->
</template>
```

### Dynamic Button Labels

Used internally by `CroutonButton` for automatic labeling:

```vue
<script setup lang="ts">
const { collectionWithCapitalSingular } = useFormatCollections()

const getButtonLabel = (action: string, collection: string) => {
  const singular = collectionWithCapitalSingular(collection)
  
  return {
    create: `Create ${singular}`,
    update: `Update ${singular}`,
    delete: `Delete ${singular}`,
    view: `View ${singular}`
  }[action]
}

console.log(getButtonLabel('create', 'shopProducts'))  // 'Create Product'
console.log(getButtonLabel('update', 'blogPosts'))     // 'Update Post'
console.log(getButtonLabel('delete', 'adminUsers'))    // 'Delete User'
</script>
```

### Page Titles and Headings

```vue
<script setup lang="ts">
const { collectionWithCapital, collectionWithCapitalSingular } = useFormatCollections()

const route = useRoute()
const collection = 'shopProducts'

const getPageTitle = () => {
  if (route.name?.includes('index')) {
    return collectionWithCapital(collection)        // 'Products' (list page)
  } else if (route.name?.includes('create')) {
    return `New ${collectionWithCapitalSingular(collection)}`  // 'New Product'
  } else if (route.name?.includes('edit')) {
    return `Edit ${collectionWithCapitalSingular(collection)}` // 'Edit Product'
  }
}
</script>

<template>
  <NuxtLayout>
    <template #header>
      <h1>{{ getPageTitle() }}</h1>
    </template>
  </NuxtLayout>
</template>
```

### Breadcrumbs

```vue
<script setup lang="ts">
const { collectionWithCapital, collectionWithCapitalSingular } = useFormatCollections()

const breadcrumbs = computed(() => {
  const collection = route.params.collection as string
  const id = route.params.id
  
  return [
    { label: 'Home', to: '/' },
    { label: collectionWithCapital(collection), to: `/${collection}` },
    id && { label: collectionWithCapitalSingular(collection), to: `/${collection}/${id}` }
  ].filter(Boolean)
})
</script>

<template>
  <!-- Breadcrumbs: Home > Products > Product -->
  <nav>
    <span v-for="(crumb, i) in breadcrumbs" :key="i">
      <NuxtLink :to="crumb.to">{{ crumb.label }}</NuxtLink>
      <span v-if="i < breadcrumbs.length - 1"> > </span>
    </span>
  </nav>
</template>
```

### Notification Messages

```vue
<script setup lang="ts">
const { collectionWithCapitalSingular } = useFormatCollections()
const toast = useToast()

const notifySuccess = (action: string, collection: string) => {
  const singular = collectionWithCapitalSingular(collection)
  
  const messages = {
    create: `${singular} created successfully`,
    update: `${singular} updated successfully`,
    delete: `${singular} deleted successfully`
  }
  
  toast.add({
    title: messages[action],
    color: 'green'
  })
}

// Usage
await mutate('create', 'shopProducts', data)
notifySuccess('create', 'shopProducts')
// Shows: "Product created successfully"
</script>
```

### Edge Cases

```vue
<script setup lang="ts">
const { collectionWithCapitalSingular } = useFormatCollections()

// Edge cases handled correctly
collectionWithCapitalSingular('')             // ''
collectionWithCapitalSingular('s')            // 's' (single char)
collectionWithCapitalSingular('news')         // 'new' (false plural)
collectionWithCapitalSingular('sheep')        // 'sheep' (irregular, stays same)
</script>
```

### Best Practices

**DO:**
- ✅ Use `collectionWithCapitalSingular()` for button labels
- ✅ Use `collectionWithCapital()` for list headings
- ✅ Use in notification messages for consistency
- ✅ Rely on automatic layer prefix stripping

**DON'T:**
- ❌ Manually strip prefixes or pluralize (use the composable)
- ❌ Hardcode collection display names
- ❌ Forget to handle empty strings

### Integration Example

Complete example showing all formatting methods:

```vue
<script setup lang="ts">
const {
  collectionWithCapital,
  collectionWithCapitalSingular,
  stripLayerPrefix,
  camelToTitleCase,
  toPascalCase
} = useFormatCollections()

const collection = 'shopProducts'

const labels = {
  listTitle: collectionWithCapital(collection),          // 'Products'
  createButton: `New ${collectionWithCapitalSingular(collection)}`,  // 'New Product'
  tableTitle: camelToTitleCase(collection),              // 'Shop Products'
  componentName: `${toPascalCase(collection)}Form`,      // 'ShopProductsForm'
  apiPath: stripLayerPrefix(collection)                  // 'products'
}
</script>

<template>
  <div>
    <h1>{{ labels.listTitle }}</h1>
    <UButton>{{ labels.createButton }}</UButton>
    <UTable :title="labels.tableTitle" />
  </div>
</template>
```

---

## useCrouton

Global modal/form state management with nested form support, pagination, and automatic team context resolution.

### Type Signature

```typescript
type CroutonAction = 'create' | 'update' | 'delete' | 'view' | null
type LoadingState = 'notLoading' | 'create_send' | 'update_send' | 'delete_send' | 'view_send' | 'create_open' | 'update_open' | 'delete_open' | 'view_open'

function useCrouton(): {
  // Modal state
  showCrouton: ComputedRef<boolean>
  loading: ComputedRef<LoadingState>
  action: ComputedRef<CroutonAction>
  items: ComputedRef<any[]>
  activeItem: ComputedRef<any>
  activeCollection: ComputedRef<string | null>
  croutonStates: Ref<CroutonState[]>

  // Modal actions
  open: (action: CroutonAction, collection: string, ids?: string[], container?: 'slideover' | 'modal' | 'dialog' | 'inline', initialData?: any) => Promise<void>
  close: (stateId?: string) => void
  closeAll: () => void
  removeState: (stateId: string) => void
  reset: () => void

  // Pagination
  pagination: Ref<PaginationMap>
  setPagination: (collection: string, paginationData: Partial<PaginationState>) => void
  getPagination: (collection: string) => PaginationState
  getDefaultPagination: (collection: string) => PaginationState
}
```

### Returns

| Property | Type | Description |
|----------|------|-------------|
| `showCrouton` | `ComputedRef<boolean>` | Whether any form is currently open |
| `loading` | `ComputedRef<LoadingState>` | Current loading state of the topmost form |
| `action` | `ComputedRef<CroutonAction>` | Current action being performed (create, update, delete, view) |
| `items` | `ComputedRef<any[]>` | Items array (used for delete operations with multiple IDs) |
| `activeItem` | `ComputedRef<any>` | Currently active item being edited/viewed |
| `activeCollection` | `ComputedRef<string \| null>` | Collection name of the topmost form |
| `croutonStates` | `Ref<CroutonState[]>` | Array of all open form states (for nested forms) |
| `open` | `Function` | Open a new form modal/slideover |
| `close` | `Function` | Close the current or specified form |
| `closeAll` | `Function` | Close all open forms |
| `removeState` | `Function` | Remove a state from the array (called after animation) |
| `reset` | `Function` | Reset all form states (for navigation scenarios) |
| `pagination` | `Ref<PaginationMap>` | Pagination state for all collections |
| `setPagination` | `Function` | Update pagination for a collection |
| `getPagination` | `Function` | Get pagination for a collection |
| `getDefaultPagination` | `Function` | Get default pagination settings |

### Opening Forms

```vue
<script setup lang="ts">
const { open } = useCrouton()

// Create new item
const handleCreate = () => {
  open('create', 'shopProducts')
}

// Edit existing item
const handleEdit = (productId: string) => {
  open('update', 'shopProducts', [productId])
}

// Delete items
const handleDelete = (productIds: string[]) => {
  open('delete', 'shopProducts', productIds)
}
</script>

<template>
  <UButton @click="handleCreate">New Product</UButton>
  <UButton @click="handleEdit('product-123')">Edit</UButton>
  <UButton @click="handleDelete(['id1', 'id2'])" color="red">Delete</UButton>
</template>
```

### Container Types

```typescript
// Slideover (default)
open('create', 'shopProducts', [], 'slideover')

// Modal
open('create', 'shopProducts', [], 'modal')

// Dialog
open('delete', 'shopProducts', ['id1'], 'dialog')
```

### Nested Forms

```vue
<script setup lang="ts">
// Open product form
open('create', 'shopProducts')

// From inside product form, open category form
open('create', 'shopCategories')  // Opens on top of product form

// Supports up to 5 levels deep
</script>
```

### Programmatic Control

```vue
<script setup lang="ts">
const { open, close, closeAll, showCrouton } = useCrouton()

// Check if any form is open
if (showCrouton.value) {
  console.log('Form is open')
}

// Close current form
close()

// Close all forms
closeAll()
</script>
```

### With Initial Data

```vue
<script setup lang="ts">
const { open } = useCrouton()

// Pre-populate form with default values
open('create', 'shopProducts', [], 'slideover', {
  categoryId: 'default-category',
  price: 0,
  inStock: true
})
</script>
```

---

## useCroutonShortcuts

Keyboard shortcuts for power-user CRUD operations with platform-aware bindings and visual hints.

### Type Signature

```typescript
interface CroutonShortcutConfig {
  create: string   // Open create form
  save: string     // Submit current form
  close: string    // Close current form/modal
  delete: string   // Delete selected items
  search: string   // Focus search input
}

interface UseCroutonShortcutsOptions {
  collection: string
  shortcuts?: Partial<CroutonShortcutConfig>
  disabled?: MaybeRef<boolean>
  selected?: Ref<string[]>
  searchRef?: Ref<HTMLInputElement | null>
  handlers?: {
    onSave?: () => void | Promise<void>
    onDelete?: (ids: string[]) => void | Promise<void>
    onCreate?: () => void
  }
}

function useCroutonShortcuts(options: UseCroutonShortcutsOptions): {
  shortcuts: CroutonShortcutConfig
  formatShortcut: (action: keyof CroutonShortcutConfig) => string
  pause: () => void
  resume: () => void
  isActive: Ref<boolean>
}
```

### Default Shortcuts

| Action | Mac | Windows/Linux | Context |
|--------|-----|---------------|---------|
| Create | `⌘N` | `Ctrl+N` | When no form is open |
| Save | `⌘S` | `Ctrl+S` | When form is open |
| Close | `Escape` | `Escape` | Closes form/modal |
| Delete | `⌘⌫` | `Ctrl+Backspace` | With selection |
| Search | `⌘K` or `/` | `Ctrl+K` or `/` | Focus search input |

### Basic Usage

```vue
<script setup lang="ts">
const selected = ref<string[]>([])
const searchRef = ref<HTMLInputElement | null>(null)

const { formatShortcut } = useCroutonShortcuts({
  collection: 'shopProducts',
  selected,
  searchRef,
  handlers: {
    onSave: () => formRef.value?.submit(),
    onDelete: async (ids) => {
      if (confirm(`Delete ${ids.length} items?`)) {
        await deleteItems(ids)
        selected.value = []
      }
    }
  }
})
</script>

<template>
  <div class="flex justify-between mb-4">
    <UInput ref="searchRef" placeholder="Search..." />

    <UButton @click="open('create', 'shopProducts')">
      New Product
      <CroutonShortcutHint :shortcut="formatShortcut('create')" subtle />
    </UButton>
  </div>

  <CroutonCollection
    v-model:selected="selected"
    collection="shopProducts"
    selectable
  />
</template>
```

### Custom Shortcuts

Override default key bindings:

```vue
<script setup lang="ts">
useCroutonShortcuts({
  collection: 'posts',
  shortcuts: {
    create: 'Meta+Shift+n',  // ⌘⇧N instead of ⌘N
    search: 'Meta+f',        // ⌘F instead of ⌘K
  }
})
</script>
```

### Pause/Resume

Temporarily disable shortcuts (e.g., during custom modal):

```vue
<script setup lang="ts">
const isCustomModalOpen = ref(false)
const { pause, resume, isActive } = useCroutonShortcuts({
  collection: 'posts',
  disabled: isCustomModalOpen, // Option 1: Reactive disable
})

// Option 2: Manual control
const openCustomModal = () => {
  pause()
  isCustomModalOpen.value = true
}

const closeCustomModal = () => {
  isCustomModalOpen.value = false
  resume()
}
</script>
```

### Display Shortcut Hints

Use the `CroutonShortcutHint` component:

```vue
<script setup lang="ts">
const { formatShortcut } = useCroutonShortcuts({ collection: 'posts' })
</script>

<template>
  <!-- Inline with button -->
  <UButton>
    Save
    <CroutonShortcutHint :shortcut="formatShortcut('save')" subtle />
  </UButton>

  <!-- Standalone -->
  <div class="flex items-center gap-2">
    <span>Press</span>
    <CroutonShortcutHint :shortcut="formatShortcut('search')" />
    <span>to search</span>
  </div>
</template>
```

### Context-Aware Behavior

Shortcuts are automatically disabled when:
- User is typing in an `<input>` or `<textarea>`
- User is in a `contenteditable` element
- `disabled` option is true
- `pause()` has been called

```vue
<script setup lang="ts">
// Shortcuts won't fire when user is typing in search
const searchRef = ref<HTMLInputElement | null>(null)

useCroutonShortcuts({
  collection: 'posts',
  searchRef,
  // ⌘N won't fire while typing in searchRef
})
</script>
```

### Form Save Handler

Connect to form submission:

```vue
<script setup lang="ts">
const formRef = ref()

useCroutonShortcuts({
  collection: 'posts',
  handlers: {
    onSave: () => {
      // Trigger form submission on ⌘S
      formRef.value?.submit()
    }
  }
})
</script>

<template>
  <UForm ref="formRef" @submit="handleSubmit">
    <!-- form fields -->
  </UForm>
</template>
```

### Best Practices

**DO:**
- ✅ Provide visual hints with `CroutonShortcutHint` for discoverability
- ✅ Use `formatShortcut()` for platform-aware display
- ✅ Connect `onSave` to form submission for ⌘S support
- ✅ Connect `onDelete` with confirmation dialog
- ✅ Disable during custom modals that capture focus

**DON'T:**
- ❌ Override common browser shortcuts (⌘C, ⌘V, ⌘Z)
- ❌ Forget to handle delete confirmation
- ❌ Leave shortcuts active during text editing

### Troubleshooting

| Issue | Solution |
|-------|----------|
| Shortcuts not firing | Check `isActive` value, ensure not typing in input |
| ⌘S opens browser save | Verify `onSave` handler is provided |
| Delete fires without selection | Check `selected` ref is populated |
| Wrong platform symbols | Ensure using `formatShortcut()` not hardcoded strings |

---

## useEntityTranslations

::callout{type="warning" icon="i-lucide-triangle-alert"}
**Package**: This composable is part of the `@fyit/crouton-i18n` package. `@fyit/crouton-core` extends that package for you, so it is available in every app that extends the core layer.
::

Display translated field values with automatic locale fallback.

### Type Signature

```typescript
function useEntityTranslations(): {
  t: (entity: any, field: string) => string
}
```

### Returns

- **t** - Translation function with fallback

### Usage

```vue
<script setup lang="ts">
const { t } = useEntityTranslations()
const { locale } = useI18n()

const product = {
  name: 'Product',
  translations: {
    en: { name: 'Product', description: 'English description' },
    nl: { name: 'Product', description: 'Nederlandse beschrijving' },
    fr: { name: 'Produit', description: 'Description française' }
  }
}
</script>

<template>
  <div>
    <h1>{{ t(product, 'name') }}</h1>
    <p>{{ t(product, 'description') }}</p>
  </div>
</template>
```

### Fallback Behavior

The `t()` function follows this priority:

1. **Current locale translation**: `entity.translations[currentLocale][field]`
2. **English translation**: `entity.translations.en[field]`
3. **Base field value**: `entity[field]`
4. **Empty string**: `''`

Example:

```typescript
// User's locale: 'nl' (Dutch)
const product = {
  name: 'Product',
  description: 'English description',
  translations: {
    en: { name: 'Product', description: 'English description' },
    nl: { name: 'Product' } // Missing 'description'
  }
}

t(product, 'name')        // 'Product' (Dutch available)
t(product, 'description') // 'English description' (fallback to EN)
t(product, 'price')       // '' (field doesn't exist)
```

### With useCollectionQuery

Combine with data fetching for automatic translated displays:

```vue
<script setup lang="ts">
const { locale } = useI18n()
const { items: products } = await useCollectionQuery('shopProducts', {
  query: computed(() => ({
    locale: locale.value  // Auto-refetch when locale changes
  }))
})

const { t } = useEntityTranslations()
</script>

<template>
  <div v-for="product in products" :key="product.id">
    <h2>{{ t(product, 'name') }}</h2>
    <p>{{ t(product, 'description') }}</p>
  </div>
</template>
```

When the user switches languages, `useCollectionQuery` automatically refetches data and `t()` displays the correct translation.

---


---

## useAssetUpload

::callout{type="warning" icon="i-lucide-triangle-alert"}
**Package Required**: This composable is part of the `@fyit/crouton-assets` package. It is **not available** in `@fyit/crouton-core` alone. Install and extend the assets package to use this composable.
::

Programmatic asset upload with metadata tracking.

### Type Signature

```typescript
function useAssetUpload(): {
  uploadAsset: (
    file: File,
    metadata?: AssetMetadata,
    collection?: string
  ) => Promise<UploadAssetResult>
  uploadAssets: (
    files: File[],
    metadata?: AssetMetadata,
    collection?: string
  ) => Promise<UploadAssetResult[]>
  uploading: Readonly<Ref<boolean>>
  error: Readonly<Ref<Error | null>>
}

interface AssetMetadata {
  alt?: string
  filename?: string
}

interface UploadAssetResult {
  id: string
  pathname: string
  filename: string
  contentType: string
  size: number
  alt?: string
}
```

### Returns

- **uploadAsset** - Upload single file with metadata
- **uploadAssets** - Upload multiple files in parallel
- **uploading** - Loading state (readonly)
- **error** - Error state (readonly)

### Basic Usage

```vue
<script setup lang="ts">
const { uploadAsset, uploading, error } = useAssetUpload()

const handleFileSelect = async (event: Event) => {
  const target = event.target as HTMLInputElement
  const file = target.files?.[0]
  if (!file) return

  try {
    const asset = await uploadAsset(file, {
      alt: 'Product image'
    })

    console.log('Uploaded:', asset.id)
    console.log('URL:', `/images/${asset.pathname}`)
  } catch (err) {
    console.error('Upload failed:', error.value)
  }
}
</script>

<template>
  <div>
    <input type="file" @change="handleFileSelect" />
    <div v-if="uploading">Uploading...</div>
  </div>
</template>
```

### With Custom Metadata

```vue
<script setup lang="ts">
const { uploadAsset } = useAssetUpload()

const uploadProductImage = async (file: File, productName: string) => {
  const asset = await uploadAsset(file, {
    alt: `${productName} product image`,
    filename: `${productName.toLowerCase().replace(/\s+/g, '-')}.jpg`
  })

  return asset.id
}
</script>
```

### Multiple File Upload

```vue
<script setup lang="ts">
const { uploadAssets, uploading } = useAssetUpload()

const handleMultipleFiles = async (event: Event) => {
  const target = event.target as HTMLInputElement
  const files = Array.from(target.files || [])

  const assets = await uploadAssets(files, {
    alt: 'Gallery image'
  })

  console.log(`Uploaded ${assets.length} files`)
  return assets.map(a => a.id)
}
</script>

<template>
  <input type="file" multiple @change="handleMultipleFiles" />
  <div v-if="uploading">Uploading files...</div>
</template>
```

### Custom Collection

By default, uploads go to the `assets` collection. You can specify a different collection:

```vue
<script setup lang="ts">
const { uploadAsset } = useAssetUpload()

// Upload to custom 'productImages' collection
const asset = await uploadAsset(file, { alt: 'Product' }, 'productImages')
</script>
```

### Error Handling

```vue
<script setup lang="ts">
const { uploadAsset, uploading, error } = useAssetUpload()
const toast = useToast()

const handleUpload = async (file: File) => {
  try {
    const asset = await uploadAsset(file, {
      alt: 'User uploaded image'
    })

    toast.add({
      title: 'Upload successful',
      description: `File ${asset.filename} uploaded`,
      color: 'green'
    })

    return asset
  } catch (err) {
    toast.add({
      title: 'Upload failed',
      description: error.value?.message || 'Unknown error',
      color: 'red'
    })
  }
}
</script>
```

### Integration with Forms

Combine with form state for seamless asset management:

```vue
<script setup lang="ts">
const { uploadAsset } = useAssetUpload()
const state = ref({
  name: '',
  imageId: ''
})

const handleImageUpload = async (file: File) => {
  const asset = await uploadAsset(file, {
    alt: state.value.name || 'Product image'
  })

  // Assign asset ID to form
  state.value.imageId = asset.id
}

const handleSubmit = async () => {
  // Create product with asset reference
  await $fetch('/api/teams/123/shopProducts', {
    method: 'POST',
    body: state.value
  })
}
</script>

<template>
  <UForm :state="state" @submit="handleSubmit">
    <UFormField label="Product Name" name="name">
      <UInput v-model="state.name" />
    </UFormField>

    <UFormField label="Product Image" name="imageId">
      <CroutonAssetPicker v-model="state.imageId" />
    </UFormField>

    <UButton type="submit">Create Product</UButton>
  </UForm>
</template>
```

### When to Use

**Use `useAssetUpload()` when:**
- Building custom upload UI
- Programmatic file uploads
- Drag-and-drop interfaces
- Batch processing files
- Custom upload workflows

**Use `CroutonAssetUploader` component when:**
- Simple form-based uploads
- Using generated CRUD forms
- Standard upload modal needed

**Use `CroutonImageUpload` component when:**
- Quick one-off uploads
- Storing URLs directly (not using asset library)
- Simple file picker needed

---


---

## useTeamContext

Resolve team identifiers for multi-tenancy API path construction with automatic fallback strategies.

### Type Signature

```typescript
function useTeamContext(): {
  getTeamId: () => string | undefined
  getTeamSlug: () => string | undefined
}
```

### Returns

| Property | Type | Description |
|----------|------|-------------|
| `getTeamId` | `() => string \| undefined` | Get team ID for API calls (preferred identifier) |
| `getTeamSlug` | `() => string \| undefined` | Get team slug for display purposes |

### How It Works

**Smart Team Resolution Strategy:**

1. **Preferred**: Try `useTeam()` composable → returns `currentTeam.id` (team ID)
2. **Fallback**: Use `route.params.team` (might be slug or ID from URL)

This allows Crouton to work seamlessly with multi-tenant apps that use team slugs in routes but need team IDs for API calls.

### Basic Usage

```vue
<script setup lang="ts">
const { getTeamId } = useTeamContext()

// Get team identifier for API paths
const teamId = getTeamId()
const apiPath = `/api/teams/${teamId}/members`

console.log('Team ID:', teamId)
// → "team_abc123" (from useTeam() if available)
// → "my-team-slug" (from route params as fallback)
</script>
```

### With Data Fetching

Used internally by `useCollectionQuery` and `useCollectionMutation`:

```vue
<script setup lang="ts">
// useCollectionQuery uses useTeamContext internally
const { items, pending } = await useCollectionQuery('shopProducts')

// Automatically resolves to correct endpoint:
// - /api/teams/{teamId}/shopProducts (if useTeam() available)
// - /api/teams/{slug}/shopProducts (fallback to route param)
</script>
```

### Get Team Slug for Display

```vue
<script setup lang="ts">
const { getTeamId, getTeamSlug } = useTeamContext()

const teamId = getTeamId()    // "team_abc123"
const teamSlug = getTeamSlug() // "my-team"

// Use ID for API calls, slug for display
const apiPath = `/api/teams/${teamId}/settings`
const displayName = `Team: ${teamSlug}`
</script>

<template>
  <div>
    <h1>{{ displayName }}</h1>
    <!-- Shows: "Team: my-team" -->
  </div>
</template>
```

### Multi-Tenancy Patterns

**Pattern 1: App with `useTeam()` composable (recommended)**

```typescript
// composables/useTeam.ts (in your app)
export function useTeam() {
  return {
    currentTeam: computed(() => ({
      id: 'team_abc123',
      slug: 'my-team',
      name: 'My Team'
    }))
  }
}

// Crouton automatically detects this composable
const { getTeamId } = useTeamContext()
const teamId = getTeamId() // → "team_abc123" (preferred!)
```

**Pattern 2: Route-based team context (fallback)**

```vue
<script setup lang="ts">
// Route: /dashboard/:team/products
// URL: /dashboard/my-team/products

const { getTeamId } = useTeamContext()
const teamId = getTeamId() // → "my-team" (from route.params.team)
</script>
```

### Super-Admin Routes

Handles super-admin contexts automatically:

```vue
<script setup lang="ts">
// Route: /super-admin/users
const route = useRoute()
const { getTeamId } = useTeamContext()

if (route.path.includes('/super-admin/')) {
  // useCollectionQuery detects super-admin context
  // → Uses /api/super-admin/users instead of /api/teams/{id}/users
}
</script>
```

### Building Custom API Paths

```vue
<script setup lang="ts">
const { getTeamId } = useTeamContext()

const buildTeamApiPath = (resource: string): string => {
  const teamId = getTeamId()
  
  if (!teamId) {
    throw new Error('Team context not available')
  }
  
  return `/api/teams/${teamId}/${resource}`
}

// Usage
const membersPath = buildTeamApiPath('members')
// → "/api/teams/team_abc123/members"

const settingsPath = buildTeamApiPath('settings')
// → "/api/teams/team_abc123/settings"
</script>
```

### Error Handling

```vue
<script setup lang="ts">
const { getTeamId } = useTeamContext()

const fetchTeamData = async () => {
  const teamId = getTeamId()
  
  if (!teamId) {
    console.error('Team context not available', {
      routePath: route.path,
      routeParams: route.params
    })
    
    // Handle missing team context
    navigateTo('/select-team')
    return
  }
  
  // Proceed with API call
  const data = await $fetch(`/api/teams/${teamId}/data`)
}
</script>
```

### Integration with Collection Queries

Crouton composables automatically use `useTeamContext`:

```vue
<script setup lang="ts">
// These automatically resolve team context:
const { items } = await useCollectionQuery('shopProducts')
const { create } = useCollectionMutation('shopProducts')

// Internally calls useTeamContext() to build:
// → /api/teams/{resolvedTeamId}/shopProducts
</script>
```

### Team Context Switching

When users switch teams, data automatically refetches:

```vue
<script setup lang="ts">
const { currentTeam, switchTeam } = useTeam() // Your app's composable
const { items, refresh } = await useCollectionQuery('shopProducts')

const handleTeamSwitch = async (newTeamId: string) => {
  await switchTeam(newTeamId)
  
  // Manually refresh if needed (or rely on watch)
  await refresh()
  
  // All API calls now use new team context
}
</script>
```

### Debug Team Resolution

```vue
<script setup lang="ts">
const { getTeamId, getTeamSlug } = useTeamContext()
const route = useRoute()

// Debug team resolution
console.log('Team Resolution:', {
  teamId: getTeamId(),
  teamSlug: getTeamSlug(),
  routeParam: route.params.team,
  routePath: route.path
})

// Example output:
// {
//   teamId: "team_abc123",
//   teamSlug: "my-team",
//   routeParam: "my-team",
//   routePath: "/dashboard/my-team/products"
// }
</script>
```

### Best Practices

**DO:**
- ✅ Implement `useTeam()` in your app for proper ID resolution
- ✅ Use `getTeamId()` for API calls (preferred identifier)
- ✅ Use `getTeamSlug()` for display purposes
- ✅ Check for undefined before making API calls
- ✅ Use consistent team param naming in routes (`:team`)

**DON'T:**
- ❌ Manually construct team API paths (use composables)
- ❌ Assume team context is always available
- ❌ Mix team IDs and slugs in API calls
- ❌ Forget to validate team context before API operations

### Troubleshooting

| Issue | Solution |
|-------|----------|
| `getTeamId()` returns `undefined` | Check that route has `:team` param or implement `useTeam()` |
| Using slug instead of ID | Implement `useTeam()` composable to return team ID |
| 404 errors on API calls | Verify team ID resolution matches server expectations |
| Team context not switching | Ensure `currentTeam` is reactive in `useTeam()` |

---


---

## useUsers

External collection connector for integrating user management systems with Crouton's reference system.

### Type Signature

```typescript
interface UserSchema {
  id: string
  title: string
  email?: string
  avatarUrl?: string
  role?: string
}

function useUsers(): ExternalCollectionConfig
```

### Returns

External collection configuration object for registering in `app.config.ts`.

### Purpose

This composable provides a **reference implementation** for connecting external user systems (e.g., authentication providers, auth databases) to Crouton's reference fields.

**Use cases:**
- Connect auth system users to Crouton forms
- Enable user selection in reference fields
- Track `createdBy` and `updatedBy` fields
- Display user info in admin panels

### Setup Instructions

**Step 1: Copy the composable to your project**

```typescript
// app/composables/useUsers.ts
import { z } from 'zod'
import { defineExternalCollection } from '#imports'

const userSchema = z.object({
  id: z.string(),
  title: z.string(), // Required for CroutonReferenceSelect
  email: z.string().optional(),
  avatarUrl: z.string().optional(),
  role: z.string().optional()
})

export const usersConfig = defineExternalCollection({
  name: 'users',
  schema: userSchema,
  meta: {
    label: 'Users',
    description: 'External user collection from auth system'
  }
})

export const useUsers = () => usersConfig
```

**Step 2: Create the API endpoint**

```typescript
// server/api/teams/[id]/users/index.get.ts
import { getActiveTeamMembers } from '~/server/database/queries/teams'
import { validateTeamOwnership } from '~/server/utils/teamValidation'

// createExternalCollectionHandler is auto-imported from nuxt-crouton
export default createExternalCollectionHandler(
  async (event) => {
    const teamId = getRouterParam(event, 'id')
    await validateTeamOwnership(event, teamId!)
    return await getActiveTeamMembers(teamId!)
  },
  (member) => ({
    id: member.userId,
    title: member.name,
    email: member.email,
    avatarUrl: member.avatarUrl,
    role: member.role
  })
)
```

**Step 3: Register in app.config.ts**

```typescript
// app.config.ts
import { usersConfig } from './composables/useUsers'

export default defineAppConfig({
  croutonCollections: {
    users: usersConfig,
    // ... other collections
  }
})
```

**Step 4: Use `:users` prefix in collection schemas**

```json
// layers/shop/collections/products.collection.json
{
  "schema": {
    "createdBy": {
      "type": "string",
      "refTarget": ":users",
      "meta": {
        "label": "Created By",
        "readOnly": true
      }
    },
    "updatedBy": {
      "type": "string",
      "refTarget": ":users",
      "meta": {
        "label": "Updated By"
      }
    }
  }
}
```

### Usage in Forms

Once registered, users appear in reference selects automatically:

```vue
<script setup lang="ts">
const state = ref({
  title: 'New Product',
  assignedTo: '', // User ID from `:users` collection
  reviewedBy: ''
})
</script>

<template>
  <UForm :state="state">
    <!-- Reference select auto-generated by Crouton -->
    <CroutonReferenceSelect
      v-model="state.assignedTo"
      collection="users"
      label="Assigned To"
    />
    
    <CroutonReferenceSelect
      v-model="state.reviewedBy"
      collection="users"
      label="Reviewed By"
    />
  </UForm>
</template>
```

### Auto-populate User Fields

**Pattern: Auto-populate `createdBy` and `updatedBy` server-side**

```typescript
// server/api/teams/[id]/products.post.ts
export default defineEventHandler(async (event) => {
  const session = await getUserSession(event)
  const body = await readBody(event)
  
  // Auto-populate user fields
  body.createdBy = session.user.id
  body.updatedBy = session.user.id
  body.createdAt = new Date().toISOString()
  body.updatedAt = new Date().toISOString()
  
  return await createProduct(body)
})

// server/api/teams/[id]/products/[productId].patch.ts
export default defineEventHandler(async (event) => {
  const session = await getUserSession(event)
  const body = await readBody(event)
  
  // Update tracking
  body.updatedBy = session.user.id
  body.updatedAt = new Date().toISOString()
  
  return await updateProduct(event.context.params.productId, body)
})
```

### Display User Info

**Pattern: Display user cards in tables**

```vue
<script setup lang="ts">
const { items } = await useCollectionQuery('shopProducts')
</script>

<template>
  <CroutonTable :items="items" collection="shopProducts">
    <!-- Auto-renders user info for createdBy field -->
    <template #createdBy-cell="{ row }">
      <CroutonUsersCardMini
        v-if="row.original.createdByUser"
        :item="row.original.createdByUser"
        :name="true"
      />
    </template>
    
    <template #updatedBy-cell="{ row }">
      <CroutonUsersCardMini
        v-if="row.original.updatedByUser"
        :item="row.original.updatedByUser"
        :name="true"
      />
    </template>
  </CroutonTable>
</template>
```

### Schema Customization

::callout{icon="i-lucide-book-open" color="blue"}
For the base userSchema definition, see the [Setup Instructions](#setup-instructions) section above.
::

Extend the user schema with custom fields:

```typescript
// app/composables/useUsers.ts
const userSchema = z.object({
  // ... base fields (id, title, email, avatarUrl, role)

  // Custom fields
  department: z.string().optional(),
  jobTitle: z.string().optional(),
  isActive: z.boolean().optional(),
  permissions: z.array(z.string()).optional()
})
```

### Transform External Data

If your auth system uses different field names:

```typescript
// server/api/teams/[id]/users/index.get.ts
export default createExternalCollectionHandler(
  async (event) => {
    const teamId = getRouterParam(event, 'id')
    return await fetchAuthSystemUsers(teamId)
  },
  (authUser) => ({
    // Transform to Crouton format
    id: authUser.user_id,           // user_id → id
    title: authUser.full_name,      // full_name → title
    email: authUser.email_address,  // email_address → email
    avatarUrl: authUser.profile_pic, // profile_pic → avatarUrl
    role: authUser.user_role        // user_role → role
  })
)
```

### Read-Only Collection

Users collection is **read-only by default** (no create/edit/delete buttons):

```typescript
export const usersConfig = defineExternalCollection({
  name: 'users',
  schema: userSchema,
  readonly: true, // Default behavior (can be omitted)
  meta: {
    label: 'Users',
    description: 'External user collection'
  }
})
```

To make it editable (if managing users in Crouton):

```typescript
readonly: false // Show edit/delete buttons in CardMini
```

### Fetch Strategy

Users collection uses **query-based fetching** by default:

```typescript
export const usersConfig = defineExternalCollection({
  name: 'users',
  schema: userSchema,
  fetchStrategy: 'query' // Default: uses ?ids= for single items
})
```

If your API supports RESTful fetching:

```typescript
fetchStrategy: 'restful' // Uses /users/{id} for single items
```

### Filter Users by Role

```typescript
// server/api/teams/[id]/users/index.get.ts
export default createExternalCollectionHandler(
  async (event) => {
    const teamId = getRouterParam(event, 'id')
    const query = getQuery(event)
    const role = query.role as string | undefined
    
    const users = await getActiveTeamMembers(teamId!)
    
    // Filter by role if specified
    if (role) {
      return users.filter(u => u.role === role)
    }
    
    return users
  },
  (member) => ({
    id: member.userId,
    title: member.name,
    email: member.email,
    role: member.role
  })
)
```

Usage:

```vue
<script setup lang="ts">
// Fetch only admin users
const { items: admins } = await useCollectionQuery('users', {
  query: computed(() => ({ role: 'admin' }))
})
</script>
```

### Integration with Audit Trails

Common pattern for tracking who created/updated records:

```typescript
// server/database/schemas/products.ts
export const products = pgTable('products', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  price: decimal('price').notNull(),
  
  // Audit fields
  createdAt: timestamp('created_at').defaultNow(),
  createdBy: text('created_by').references(() => users.id),
  updatedAt: timestamp('updated_at').defaultNow(),
  updatedBy: text('updated_by').references(() => users.id)
})
```

### Best Practices

**DO:**
- ✅ Use `:users` prefix for external user references
- ✅ Transform auth system data to Crouton format (`id`, `title`)
- ✅ Auto-populate user fields server-side
- ✅ Keep readonly: true unless managing users in Crouton
- ✅ Include `avatarUrl` for better UX

**DON'T:**
- ❌ Store sensitive data (passwords, tokens) in user schema
- ❌ Expose all auth system fields to client
- ❌ Forget to validate team ownership in API endpoints
- ❌ Mix user IDs from different auth systems

### Troubleshooting

| Issue | Solution |
|-------|----------|
| Users not appearing in select | Check API endpoint returns `{ id, title }` format |
| 404 on user fetch | Verify `fetchStrategy` matches API implementation |
| Duplicate user collections | Use `:users` prefix to avoid collision with Crouton-managed users |
| Missing `title` field | Transform `name` or `full_name` to `title` in handler |

---


---

## useCroutonError

Global error checking and user feedback system for blocking invalid operations.

### Type Signature

```typescript
function useCroutonError(): {
  foundErrors: () => boolean
  activeToast: Ref<boolean>
  toastVibration: Ref<boolean>
}
```

### Returns

| Property | Type | Description |
|----------|------|-------------|
| `foundErrors` | `() => boolean` | Check for blocking errors (network, auth) |
| `activeToast` | `Ref<boolean>` | Whether error toast is currently displayed |
| `toastVibration` | `Ref<boolean>` | Vibration state for duplicate error prevention |

### How It Works

**Error Checking Sequence:**

1. **Network Status**: Check `useNetwork().isOnline`
2. **Authentication**: Check `useUserSession().loggedIn`
3. **Toast Display**: Show error toast if issues found
4. **Duplicate Prevention**: Vibrate toast instead of showing multiple

### Basic Usage

```vue
<script setup lang="ts">
const { foundErrors } = useCroutonError()

const handleSave = async () => {
  // Block operation if errors detected
  if (foundErrors()) {
    console.log('Operation blocked due to errors')
    return
  }
  
  // Proceed with save
  await saveTodo()
}
</script>

<template>
  <UButton @click="handleSave">
    Save Changes
  </UButton>
</template>
```

### Integrated with useCrouton

`useCrouton()` automatically checks for errors before opening forms:

```vue
<script setup lang="ts">
const { open } = useCrouton()

// This internally calls foundErrors() before opening
const handleCreate = () => {
  open('create', 'shopProducts')
  
  // If user is offline → shows error toast, blocks modal
  // If user is not logged in → shows error toast, blocks modal
  // Otherwise → opens create form
}
</script>
```

### Manual Error Checking

```vue
<script setup lang="ts">
const { foundErrors } = useCroutonError()

const performCriticalOperation = async () => {
  // Check before expensive operations
  if (foundErrors()) {
    console.log('Aborting critical operation')
    return { success: false, error: 'Precondition failed' }
  }
  
  // Proceed with operation
  const result = await $fetch('/api/critical-action', {
    method: 'POST'
  })
  
  return { success: true, result }
}
</script>
```

### Error Types Checked

**1. Network Connectivity**

```typescript
// Checks: useNetwork().isOnline
if (!isOnline) {
  // Shows toast: "Check your connection status."
  return true
}
```

**2. Authentication Status**

```typescript
// Checks: useUserSession().loggedIn
if (!loggedIn) {
  // Shows toast: "You are not logged in."
  return true
}
```

### Toast Duplication Prevention

The composable prevents showing multiple error toasts:

```vue
<script setup lang="ts">
const { foundErrors, activeToast, toastVibration } = useCroutonError()

// First call: Shows toast
foundErrors() // → activeToast = true, shows error

// Second call (within 500ms): Vibrates toast instead
foundErrors() // → toastVibration = true, no new toast

// After 500ms: activeToast resets, can show new toast
</script>
```

### Custom Error Handling

Extend error checking for custom conditions:

```vue
<script setup lang="ts">
const { foundErrors } = useCroutonError()

const checkCustomErrors = (): boolean => {
  // Check standard errors first
  if (foundErrors()) {
    return true
  }
  
  // Check custom conditions
  const userPermissions = useUserPermissions()
  if (!userPermissions.canCreateProducts) {
    const toast = useToast()
    toast.add({
      title: 'Permission denied',
      description: 'You do not have permission to create products',
      color: 'error'
    })
    return true
  }
  
  // Check team subscription
  const { currentTeam } = useTeam()
  if (!currentTeam.value?.isSubscribed) {
    const toast = useToast()
    toast.add({
      title: 'Subscription required',
      description: 'Upgrade your plan to create more products',
      color: 'error'
    })
    return true
  }
  
  return false
}
</script>
```

### Integration with Forms

```vue
<script setup lang="ts">
const { foundErrors } = useCroutonError()
const { create } = useCollectionMutation('shopProducts')

const state = ref({
  name: '',
  price: 0
})

const handleSubmit = async () => {
  // Block submit if errors exist
  if (foundErrors()) {
    return
  }
  
  try {
    await create(state.value)
    navigateTo('/products')
  } catch (error) {
    console.error('Create failed:', error)
  }
}
</script>

<template>
  <UForm :state="state" @submit="handleSubmit">
    <UFormField label="Name" name="name">
      <UInput v-model="state.name" />
    </UFormField>
    
    <UButton type="submit">
      Create Product
    </UButton>
  </UForm>
</template>
```

### Batch Operations

```vue
<script setup lang="ts">
const { foundErrors } = useCroutonError()

const bulkDelete = async (ids: string[]) => {
  // Check once before batch operation
  if (foundErrors()) {
    return { success: false, deleted: 0 }
  }
  
  let deleted = 0
  for (const id of ids) {
    try {
      await $fetch(`/api/items/${id}`, { method: 'DELETE' })
      deleted++
    } catch (error) {
      console.error(`Failed to delete ${id}:`, error)
    }
  }
  
  return { success: true, deleted }
}
</script>
```

### Visual Toast Vibration

The vibration state can be used for UI feedback:

```vue
<script setup lang="ts">
const { activeToast, toastVibration } = useCroutonError()
</script>

<template>
  <div
    v-if="activeToast"
    class="error-toast"
    :class="{ 'vibrate': toastVibration }"
  >
    Error notification
  </div>
</template>

<style scoped>
.vibrate {
  animation: shake 0.5s;
}

@keyframes shake {
  0%, 100% { transform: translateX(0); }
  25% { transform: translateX(-10px); }
  75% { transform: translateX(10px); }
}
</style>
```

### Debug Error Checking

```vue
<script setup lang="ts">
const { foundErrors } = useCroutonError()

const debugErrors = () => {
  const network = useNetwork()
  const session = useUserSession()
  
  console.log('Error Check Debug:', {
    isOnline: network.isOnline.value,
    loggedIn: session.loggedIn?.value,
    willBlock: foundErrors()
  })
}

// Call before critical operations
debugErrors()
</script>
```

### Best Practices

**DO:**
- ✅ Call `foundErrors()` before data mutations
- ✅ Call `foundErrors()` before expensive operations
- ✅ Rely on automatic checking in `useCrouton()`
- ✅ Extend with custom error conditions for your app

**DON'T:**
- ❌ Bypass error checking for "quick" operations
- ❌ Show custom error toasts while `activeToast` is true
- ❌ Forget to return early when `foundErrors()` is true
- ❌ Use for validation errors (use form validation instead)

### When to Use

| Scenario | Use `foundErrors()` |
|----------|-------------------|
| Opening CRUD forms | ✅ Automatic (via useCrouton) |
| Manual mutations | ✅ Call before mutation |
| Batch operations | ✅ Call once before batch |
| Form validation | ❌ Use Zod schemas instead |
| API errors (500, 404) | ❌ Use try/catch instead |
| Permission checks | ⚠️ Extend with custom checks |

### Troubleshooting

| Issue | Solution |
|-------|----------|
| Toast not showing | Check `useToast()` is available and Nuxt UI configured |
| Multiple toasts appearing | Wait for `activeToast` to reset (automatic after close) |
| False positives | Debug with console logs, check `useNetwork()` and `useUserSession()` |
| Custom errors not blocked | Extend `checkCustomErrors()` pattern above |

---


---

## useT

::callout{type="info" icon="i-lucide-info"}
**Stub vs Full Implementation**: `@fyit/crouton-core` ships a **stub implementation** of `useT()` with English fallbacks for common UI strings. The full implementation (database-backed translations, multiple locales, translation management UI) comes from `@fyit/crouton-i18n`, which core extends for you.
::

Translation helper composable with fallback support for UI strings and content.

### Type Signature

```typescript
function useT(): {
  t: (key: string, options?: any) => string
  tString: (key: string, options?: any) => string
  tContent: (entity: any, field: string, preferredLocale?: string) => string
  tInfo: (key: string, options?: any) => TranslationInfo
  hasTranslation: (key: string) => boolean
  getAvailableLocales: (key: string) => string[]
  getTranslationMeta: (key: string) => TranslationMeta
  refreshTranslations: () => Promise<void>
  locale: Ref<string>
  isDev: boolean
  devModeEnabled: Ref<boolean>
}
```

### Returns

| Property | Type | Description |
|----------|------|-------------|
| `t` | `(key: string, options?: any) => string` | Main translation function |
| `tString` | `(key: string, options?: any) => string` | String-only translation (same as `t`) |
| `tContent` | `(entity: any, field: string, locale?: string) => string` | Translate entity field content |
| `tInfo` | `(key: string) => TranslationInfo` | Get translation metadata |
| `hasTranslation` | `(key: string) => boolean` | Check if translation exists |
| `getAvailableLocales` | `(key: string) => string[]` | Get locales for key |
| `getTranslationMeta` | `(key: string) => TranslationMeta` | Get translation metadata |
| `refreshTranslations` | `() => Promise<void>` | Reload translations |
| `locale` | `Ref<string>` | Current locale |
| `isDev` | `boolean` | Development mode flag |
| `devModeEnabled` | `Ref<boolean>` | Translation dev mode |

### How It Works

**Two Modes:**

1. **Stub Mode (Base Layer)**: Returns English fallbacks for common UI strings
2. **Full i18n Mode**: Activated when `@fyit/crouton-i18n` layer is installed

### Basic Usage (Stub Mode)

```vue
<script setup lang="ts">
const { t } = useT()

// Common UI strings have English fallbacks
const searchLabel = t('table.search')        // → "Search"
const saveLabel = t('common.save')           // → "Save"
const cancelLabel = t('common.cancel')       // → "Cancel"

// Unknown keys return the key itself
const unknownLabel = t('my.custom.key')      // → "my.custom.key"
</script>

<template>
  <UInput :placeholder="searchLabel" />
  <UButton>{{ saveLabel }}</UButton>
  <UButton variant="ghost">{{ cancelLabel }}</UButton>
</template>
```

### Built-in Fallback Keys

**Table Translations:**
```typescript
'table.search' → 'Search'
'table.selectAll' → 'Select all'
'table.selectRow' → 'Select row'
'table.createdAt' → 'Created At'
'table.updatedAt' → 'Updated At'
'table.createdBy' → 'Created By'
'table.updatedBy' → 'Updated By'
'table.actions' → 'Actions'
'table.display' → 'Display'
'table.rowsPerPage' → 'Rows per page'
'table.rowsPerPageColon' → 'Rows per page:'
'table.showing' → 'Showing'
'table.to' → 'to'
'table.of' → 'of'
'table.results' → 'results'
```

**Common Translations:**
```typescript
'common.loading' → 'Loading'
'common.save' → 'Save'
'common.cancel' → 'Cancel'
'common.delete' → 'Delete'
'common.edit' → 'Edit'
'common.create' → 'Create'
'common.update' → 'Update'
```

### Using in Components

**Table Search:**
```vue
<script setup lang="ts">
const { t } = useT()
</script>

<template>
  <CroutonTableSearch
    v-model="search"
    :placeholder="t('table.search')"
  />
</template>
```

**Button Labels:**
```vue
<script setup lang="ts">
const { t } = useT()
</script>

<template>
  <UButton>{{ t('common.save') }}</UButton>
  <UButton color="gray" variant="ghost">{{ t('common.cancel') }}</UButton>
  <UButton color="red">{{ t('common.delete') }}</UButton>
</template>
```

**Loading States:**
```vue
<script setup lang="ts">
const { t } = useT()
const { pending } = await useCollectionQuery('shopProducts')
</script>

<template>
  <div v-if="pending">
    {{ t('common.loading') }}
  </div>
</template>
```

### Content Translation (tContent)

Translate entity fields (for multilingual content):

```vue
<script setup lang="ts">
const { tContent } = useT()

const product = {
  name: 'Default Name',
  description: 'Default Description',
  translations: {
    en: {
      name: 'Product',
      description: 'English description'
    },
    nl: {
      name: 'Product',
      description: 'Nederlandse beschrijving'
    },
    fr: {
      name: 'Produit',
      description: 'Description française'
    }
  }
}

// Get translated content
const name = tContent(product, 'name')             // Current locale
const nameNl = tContent(product, 'name', 'nl')     // Specific locale
</script>

<template>
  <h1>{{ tContent(product, 'name') }}</h1>
  <p>{{ tContent(product, 'description') }}</p>
</template>
```

### Fallback Behavior

When translation is missing, `tContent` falls back through:

1. Current locale translation
2. English translation
3. Base field value
4. Empty string

```typescript
const { tContent, locale } = useT()
locale.value = 'nl' // Dutch

const product = {
  name: 'Default Name',
  translations: {
    en: { name: 'English Name' }
    // Missing 'nl' translation
  }
}

tContent(product, 'name')
// → Tries 'nl' (not found)
// → Falls back to 'en': "English Name"
```

### Check Translation Existence

```vue
<script setup lang="ts">
const { hasTranslation } = useT()

if (hasTranslation('table.search')) {
  console.log('Translation exists')
} else {
  console.log('Using fallback')
}

// In stub mode: always returns false
// In i18n mode: checks translation registry
</script>
```

### Get Available Locales

```vue
<script setup lang="ts">
const { getAvailableLocales } = useT()

const locales = getAvailableLocales('table.search')
// Stub mode: ['en']
// i18n mode: ['en', 'nl', 'fr', ...] (actual available locales)
</script>
```

### Translation Metadata

```vue
<script setup lang="ts">
const { tInfo } = useT()

const info = tInfo('table.search')
console.log(info)
// {
//   key: 'table.search',
//   value: 'Search',
//   mode: 'system',
//   category: 'ui',
//   isMissing: false,
//   hasTeamOverride: false
// }
</script>
```

### Full i18n Mode

When `@fyit/crouton-i18n` is installed, `useT()` is automatically replaced with full i18n functionality:

```bash
pnpm add @fyit/crouton-i18n
```

**Additional features in i18n mode:**
- Database-backed translations
- Team-specific overrides
- Translation management UI
- Locale switching
- Missing translation detection
- Translation dev mode

### Integration with Tables

Used automatically in `CroutonTable`:

```vue
<!-- Internal implementation -->
<script setup lang="ts">
const { t, tString } = useT()
</script>

<template>
  <CroutonTableSearch
    v-model="search"
    :placeholder="tString('table.search')"
  />
  
  <div class="pagination-info">
    {{ t('table.showing') }} {{ start }} {{ t('table.to') }} {{ end }} {{ t('table.of') }} {{ total }} {{ t('table.results') }}
  </div>
</template>
```

### Custom Fallbacks

Extend fallback map for your app:

```typescript
// app/composables/useT.ts (override stub)
export function useT() {
  const translate = (key: string): string => {
    const fallbacks: Record<string, string> = {
      // Crouton defaults
      'table.search': 'Search',
      'common.save': 'Save',
      
      // Your custom fallbacks
      'app.welcome': 'Welcome to My App',
      'app.logout': 'Log Out',
      'product.title': 'Product Name'
    }
    
    return fallbacks[key] || key
  }
  
  return {
    t: translate,
    tString: translate,
    // ... other methods
  }
}
```

### Best Practices

**DO:**
- ✅ Use `t()` for all UI strings (consistent API)
- ✅ Use `tContent()` for multilingual entity fields
- ✅ Define fallbacks for common app strings
- ✅ Install i18n layer for production apps
- ✅ Use `tString()` when type needs to be string (rare)

**DON'T:**
- ❌ Hardcode strings in components
- ❌ Mix `t()` and hardcoded strings
- ❌ Forget to check stub mode limitations
- ❌ Use for dynamic user-generated content

### When to Upgrade to i18n Layer

**Use stub mode when:**
- ✅ Building prototypes or MVPs
- ✅ Single-language apps (English only)
- ✅ Don't need translation management UI

**Upgrade to i18n layer when:**
- ✅ Supporting multiple languages
- ✅ Need team-specific translations
- ✅ Want translation management UI
- ✅ Need to track missing translations
- ✅ Building production multi-tenant apps

### Troubleshooting

| Issue | Solution |
|-------|----------|
| Translation returns key | Key not in fallback map, add to fallbacks or install i18n layer |
| `tContent` returns empty | Check entity has `translations` object and field exists |
| Locale not switching | Install `@fyit/crouton-i18n` for full support |
| Missing translations | Use i18n layer's translation management UI |


---

## useDependentFieldResolver

Resolves a field value from a parent collection's JSON array field. Used for complex data relationships where a field stores an ID that references an object within another collection's JSON array.

### Type Signature

```typescript
interface DependentFieldResolverOptions {
  valueId: string | Ref<string> | (() => string)
  parentId: string | Ref<string> | (() => string)
  parentCollection: string
  parentField: string
}

interface DependentFieldResolverReturn<T = any> {
  resolvedValue: ComputedRef<T | null>
  pending: Ref<boolean>
  error: Ref<any>
}

async function useDependentFieldResolver<T = any>(
  options: DependentFieldResolverOptions
): Promise<DependentFieldResolverReturn<T>>
```

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `valueId` | `string \| Ref<string> \| (() => string)` | Yes | ID to search for in parent's array field |
| `parentId` | `string \| Ref<string> \| (() => string)` | Yes | Parent collection item ID |
| `parentCollection` | `string` | Yes | Collection containing the parent (e.g., 'bookingsLocations') |
| `parentField` | `string` | Yes | Field name in parent containing the array (e.g., 'slots') |

### Returns

| Property | Type | Description |
|----------|------|-------------|
| `resolvedValue` | `ComputedRef<T \| null>` | The found object from parent's array, or null |
| `pending` | `Ref<boolean>` | Whether parent item is still loading |
| `error` | `Ref<any>` | Error if parent fetch failed |

### Use Case Example

**Problem**: A booking has a `slotId` field that references a slot object in a location's `slots` array. How do you display the slot details?

```typescript
// bookingsBookings collection
{
  id: 'booking-123',
  location: 'location-456',
  slotId: 'tvmNIE0CGmS7uxQe0y0YM',  // ← ID to resolve
  // ...
}

// bookingsLocations collection
{
  id: 'location-456',
  name: 'Main Location',
  slots: [  // ← JSON array containing slot objects
    {
      id: 'tvmNIE0CGmS7uxQe0y0YM',
      label: 'Room 123',
      value: '123',
      capacity: 10
    },
    {
      id: 'another-slot-id',
      label: 'Room 456',
      value: '456',
      capacity: 8
    }
  ]
}
```

### Basic Usage

Resolve a booking's slot details:

```vue
<script setup lang="ts">
const props = defineProps<{
  bookingId: string
  bookingData: any
}>()

// Resolve slot details from location's slots array
const { resolvedValue: slot, pending, error } = await useDependentFieldResolver({
  valueId: props.bookingData.slotId,
  parentId: props.bookingData.location,
  parentCollection: 'bookingsLocations',
  parentField: 'slots'
})
</script>

<template>
  <div v-if="pending">Loading slot details...</div>
  <div v-else-if="error">Error: {{ error.message }}</div>
  <div v-else-if="slot">
    <h3>{{ slot.label }}</h3>
    <p>Capacity: {{ slot.capacity }}</p>
  </div>
</template>
```

### With Reactive Values

When IDs come from reactive sources (refs, props, computed):

```vue
<script setup lang="ts">
const slotId = ref('tvmNIE0CGmS7uxQe0y0YM')
const locationId = ref('location-456')

// Reactively resolves when either ID changes
const { resolvedValue: slot, pending } = await useDependentFieldResolver({
  valueId: slotId,
  parentId: locationId,
  parentCollection: 'bookingsLocations',
  parentField: 'slots'
})

// Change IDs to resolve different slot
const selectDifferentSlot = (newSlotId: string) => {
  slotId.value = newSlotId
  // resolvedValue automatically updates
}
</script>
```

### With Getter Functions

For lazy evaluation:

```vue
<script setup lang="ts">
const props = defineProps<{
  booking: any
}>()

const { resolvedValue: slot } = await useDependentFieldResolver({
  valueId: () => props.booking.slotId,
  parentId: () => props.booking.location,
  parentCollection: 'bookingsLocations',
  parentField: 'slots'
})
</script>
```

### Display Slot in Template

```vue
<script setup lang="ts">
const { resolvedValue: slot, pending, error } = await useDependentFieldResolver({
  valueId: 'tvmNIE0CGmS7uxQe0y0YM',
  parentId: 'location-456',
  parentCollection: 'bookingsLocations',
  parentField: 'slots'
})
</script>

<template>
  <UCard v-if="!pending && slot" class="p-4">
    <template #header>
      <div class="flex items-center gap-2">
        <i-lucide-clock class="w-5 h-5" />
        <span>{{ slot.label }}</span>
      </div>
    </template>
    
    <div class="space-y-2">
      <div class="flex justify-between">
        <span class="text-gray-600">Capacity:</span>
        <span class="font-semibold">{{ slot.capacity }} people</span>
      </div>
      
      <div class="flex justify-between">
        <span class="text-gray-600">Value:</span>
        <span class="font-semibold">{{ slot.value }}</span>
      </div>
    </div>
  </UCard>
  
  <USkeleton v-else-if="pending" class="h-32" />
  
  <UAlert
    v-else-if="error"
    icon="i-lucide-alert-circle"
    color="red"
    title="Failed to load slot details"
  />
</template>
```

### Complex Nested Resolution

Resolve deeply nested arrays:

```vue
<script setup lang="ts">
// Parent item has nested array
const parent = {
  id: 'parent-123',
  categories: [
    {
      id: 'cat-1',
      name: 'Category 1',
      options: [
        { id: 'opt-1', label: 'Option 1' }
      ]
    }
  ]
}

// Resolve category
const { resolvedValue: category } = await useDependentFieldResolver({
  valueId: 'cat-1',
  parentId: 'parent-123',
  parentCollection: 'products',
  parentField: 'categories'
})
// → { id: 'cat-1', name: 'Category 1', options: [...] }

// To get option from category, use another resolver
const { resolvedValue: option } = await useDependentFieldResolver({
  valueId: 'opt-1',
  parentId: 'parent-123',
  parentCollection: 'products',
  // First access category from categories array
  parentField: 'categories' // Would need custom logic for nested
})
</script>
```

### With Reference Display Component

Common pattern for displaying resolved references:

```vue
<!-- ResolvedSlotBadge.vue -->
<script setup lang="ts">
const props = defineProps<{
  slotId: string
  locationId: string
}>()

const { resolvedValue: slot, pending, error } = await useDependentFieldResolver({
  valueId: computed(() => props.slotId),
  parentId: computed(() => props.locationId),
  parentCollection: 'bookingsLocations',
  parentField: 'slots'
})
</script>

<template>
  <UBadge
    v-if="!pending && slot"
    color="blue"
    variant="soft"
  >
    {{ slot.label }}
  </UBadge>
  
  <USkeleton v-else-if="pending" class="h-6 w-24" />
  
  <UBadge v-else-if="error" color="red">
    Error loading
  </UBadge>
</template>
```

Usage in table or list:

```vue
<template>
  <div v-for="booking in bookings" :key="booking.id">
    <ResolvedSlotBadge
      :slot-id="booking.slotId"
      :location-id="booking.location"
    />
  </div>
</template>
```

### Error Handling

```vue
<script setup lang="ts">
const { resolvedValue: slot, error, pending } = await useDependentFieldResolver({
  valueId: 'invalid-slot-id',
  parentId: 'location-456',
  parentCollection: 'bookingsLocations',
  parentField: 'slots'
})

watchEffect(() => {
  if (error.value) {
    console.error('Parent fetch failed:', error.value)
    // Parent collection unreachable or doesn't exist
  }
  
  if (resolvedValue.value === null && !pending.value && !error.value) {
    console.warn('Slot ID not found in array')
    // slotId exists but no matching object in slots array
  }
})
</script>
```

### Algorithm Deep Dive

How the resolution works internally:

```typescript
// 1. Fetch parent item
const { item: parentItem } = await useCollectionItem(parentCollection, parentId)

// 2. Extract array field
const arrayField = parentItem.value[parentField] // e.g., slots array

// 3. Find by ID
const found = arrayField.find(item => item.id === valueId)

// 4. Return with reactivity
return {
  resolvedValue: computed(() => found),
  pending,
  error
}

// Reactivity: If valueId or parentId changes, refetch parent and search again
```

### Best Practices

**DO:**
- ✅ Use for displaying resolved references in tables/lists
- ✅ Pass reactive values (ref, computed, function) for automatic updates
- ✅ Handle pending state while loading
- ✅ Display error state if resolution fails
- ✅ Use with card components for detail display

**DON'T:**
- ❌ Use for simple ID → title mapping (use `useCollectionItem` instead)
- ❌ Resolve multiple levels in a chain (redesign data structure)
- ❌ Forget to handle null when ID doesn't match array
- ❌ Leave pending state unhandled (shows "Error loading" to users)

### Troubleshooting

| Issue | Cause | Solution |
|-------|-------|----------|
| Always returns null | Field name wrong or not an array | Check parentField name matches collection schema |
| Parent fails to load | Collection unreachable or ID invalid | Verify parentCollection exists and ID is correct |
| Updates don't reflect | Passing static string instead of ref | Use `ref`, `computed`, or getter function |
| Performance slow | Resolving too many items in list | Cache results or batch queries differently |

---


---

## useExpandableSlideover

Manages expandable slideover state with smooth transitions between sidebar and fullscreen modes.

### Type Signature

```typescript
interface UseExpandableSlideoverOptions {
  defaultExpanded?: boolean
  maxWidth?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '4xl' | '7xl' | 'full'
  closeOnExpand?: boolean
}

function useExpandableSlideover(options?: UseExpandableSlideoverOptions): {
  // State
  isOpen: Ref<boolean>
  isExpanded: Ref<boolean>
  
  // Actions
  toggleExpand(): void
  expand(): void
  collapse(): void
  open(expanded?: boolean): void
  close(): void
  
  // UI Configuration
  slideoverUi: ComputedRef<{
    overlay: string
    content: string
    wrapper: string
    body: string
    header: string
  }>
  side: ComputedRef<'right'>
  expandIcon: ComputedRef<string>
  expandTooltip: ComputedRef<string>
}
```

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `defaultExpanded` | `boolean` | No | `false` | Start expanded or collapsed |
| `maxWidth` | `'sm' \| 'md' \| 'lg' \| 'xl' \| '2xl' \| '4xl' \| '7xl' \| 'full'` | No | `'xl'` | Max width in sidebar mode |
| `closeOnExpand` | `boolean` | No | `false` | Close slideover after expand |

### Returns

| Property | Type | Description |
|----------|------|-------------|
| `isOpen` | `Ref<boolean>` | Whether slideover is visible |
| `isExpanded` | `Ref<boolean>` | Whether in fullscreen mode |
| `toggleExpand()` | `void` | Toggle between modes with animation |
| `expand()` | `void` | Switch to fullscreen |
| `collapse()` | `void` | Switch to sidebar |
| `open(expanded?)` | `void` | Open slideover, optionally expanded |
| `close()` | `void` | Close with animation |
| `slideoverUi` | `ComputedRef<...>` | Tailwind classes for different modes |
| `side` | `ComputedRef<'right'>` | Always 'right' |
| `expandIcon` | `ComputedRef<string>` | Icon for expand/collapse button |
| `expandTooltip` | `ComputedRef<string>` | Tooltip text for button |

### Basic Usage

Simple sidebar with expand button:

```vue
<script setup lang="ts">
const {
  isOpen,
  isExpanded,
  toggleExpand,
  expand,
  collapse,
  open,
  close,
  expandIcon,
  expandTooltip
} = useExpandableSlideover({ maxWidth: '2xl' })

const handleOpenForm = () => {
  open() // Open in sidebar mode
}

const handleOpenImmersive = () => {
  open(true) // Open already expanded
}
</script>

<template>
  <div class="flex gap-4">
    <UButton @click="handleOpenForm">
      Open in Sidebar
    </UButton>
    
    <UButton @click="handleOpenImmersive">
      Open Fullscreen
    </UButton>
  </div>
  
  <USlideover v-model="isOpen" side="right">
    <template #header="{ close: closeSlideover }">
      <div class="flex items-center justify-between">
        <h2 class="text-lg font-semibold">Form Title</h2>
        
        <div class="flex gap-2">
          <UTooltip :text="expandTooltip">
            <UButton
              :icon="expandIcon"
              color="gray"
              variant="ghost"
              @click="toggleExpand"
            />
          </UTooltip>
          
          <UButton
            icon="i-lucide-x"
            color="gray"
            variant="ghost"
            @click="closeSlideover"
          />
        </div>
      </div>
    </template>
    
    <template #content>
      <!-- Form content -->
      <div class="p-6">
        <YourFormComponent />
      </div>
    </template>
  </USlideover>
</template>
```

### Width Presets

Control sidebar width when not expanded:

```vue
<script setup lang="ts">
// Small sidebar
const { isExpanded } = useExpandableSlideover({ maxWidth: 'sm' })
// → max-w-sm = 384px

// Medium sidebar
const { isExpanded } = useExpandableSlideover({ maxWidth: 'md' })
// → max-w-md = 448px

// Large sidebar (default-ish)
const { isExpanded } = useExpandableSlideover({ maxWidth: 'xl' })
// → max-w-xl = 672px

// Extra large sidebar
const { isExpanded } = useExpandableSlideover({ maxWidth: '2xl' })
// → max-w-2xl = 768px

// Full width sidebar (uses entire right side)
const { isExpanded } = useExpandableSlideover({ maxWidth: 'full' })
// → 100% of viewport width
</script>
```

### Start Expanded

Open directly in fullscreen mode:

```vue
<script setup lang="ts">
const { isOpen, open } = useExpandableSlideover({
  defaultExpanded: true
})

const handleOpen = () => {
  open(true) // Opens already expanded
}
</script>

<template>
  <USlideover v-model="isOpen">
    <!-- Content renders in fullscreen immediately -->
  </USlideover>
</template>
```

### Close on Expand

Useful for immersive editing experiences:

```vue
<script setup lang="ts">
const { open, toggleExpand } = useExpandableSlideover({
  closeOnExpand: true
})

// When user clicks expand button:
// 1. Expand to fullscreen
// 2. Wait 300ms
// 3. Close sideover panel
// 4. Form is now fullscreen in new container
</script>
```

### Expand/Collapse Transitions

Smooth 300ms animations between modes:

```vue
<script setup lang="ts">
const {
  isExpanded,
  toggleExpand,
  slideoverUi
} = useExpandableSlideover()

// slideoverUi provides animated classes:
// - transition-[max-width,width] duration-300 ease-in-out
// - transition-all duration-300 ease-in-out

// When isExpanded changes:
// 1. Width animates smoothly (300ms)
// 2. Overlay opacity transitions
// 3. Content padding adjusts
</script>

<template>
  <!-- USlideover automatically applies slideoverUi classes -->
  <USlideover
    v-model="isOpen"
    side="right"
    :ui="slideoverUi"
  >
    <template #content>
      <div :class="slideoverUi.body">
        <!-- Content grows/shrinks with sidebar -->
        <YourContent />
      </div>
    </template>
  </USlideover>
</template>
```

### Icon and Tooltip Management

Display button with context-aware label:

```vue
<script setup lang="ts">
const {
  isExpanded,
  expandIcon,
  expandTooltip,
  toggleExpand
} = useExpandableSlideover()

// When collapsed:
// expandIcon = 'i-lucide-maximize-2'
// expandTooltip = 'Expand to fullscreen'

// When expanded:
// expandIcon = 'i-lucide-minimize-2'
// expandTooltip = 'Collapse to sidebar'
</script>

<template>
  <UButton
    :icon="expandIcon"
    :ui="{ base: 'group' }"
    @click="toggleExpand"
  >
    <UTooltip :text="expandTooltip" :shortcuts="['F11']">
      <template #default>
        <!-- Button shows appropriate icon/tooltip -->
      </template>
    </UTooltip>
  </UButton>
</template>
```

### Complete Form Example

Full form with expandable sidebar:

```vue
<script setup lang="ts">
import { ref } from 'vue'

const {
  isOpen,
  isExpanded,
  open,
  close,
  toggleExpand,
  expandIcon,
  expandTooltip,
  slideoverUi
} = useExpandableSlideover({ maxWidth: '2xl' })

const formData = ref({
  name: '',
  email: '',
  bio: ''
})

const handleSubmit = () => {
  // Save form data
  console.log('Saving:', formData.value)
  close()
}

const handleOpenEdit = () => {
  open() // Open in sidebar
}
</script>

<template>
  <div class="space-y-4">
    <UButton @click="handleOpenEdit">
      Open Editor
    </UButton>
    
    <USlideover
      v-model="isOpen"
      side="right"
      :ui="slideoverUi"
    >
      <template #header="{ close: closeSlideover }">
        <div class="flex items-center justify-between w-full">
          <h2 class="text-lg font-semibold">
            {{ isExpanded ? 'Full Editor' : 'Quick Edit' }}
          </h2>
          
          <div class="flex gap-2">
            <UTooltip :text="expandTooltip">
              <UButton
                :icon="expandIcon"
                color="gray"
                variant="ghost"
                size="sm"
                @click="toggleExpand"
              />
            </UTooltip>
            
            <UButton
              icon="i-lucide-x"
              color="gray"
              variant="ghost"
              size="sm"
              @click="closeSlideover"
            />
          </div>
        </div>
      </template>
      
      <template #content>
        <div :class="slideoverUi.body">
          <UForm :state="formData" @submit="handleSubmit">
            <UFormField label="Name" name="name">
              <UInput v-model="formData.name" />
            </UFormField>
            
            <UFormField label="Email" name="email">
              <UInput v-model="formData.email" type="email" />
            </UFormField>
            
            <UFormField label="Bio" name="bio">
              <UTextarea v-model="formData.bio" rows="6" />
            </UFormField>
            
            <div class="flex gap-2 mt-6">
              <UButton
                type="submit"
                color="primary"
              >
                Save Changes
              </UButton>
              
              <UButton
                color="gray"
                variant="ghost"
                @click="close"
              >
                Cancel
              </UButton>
            </div>
          </UForm>
        </div>
      </template>
    </USlideover>
  </div>
</template>
```

### Fullscreen Mode Styling

When expanded, the modal takes full viewport:

```vue
<script setup lang="ts">
const { isExpanded, slideoverUi } = useExpandableSlideover()

// In fullscreen mode:
// - No max-width constraint (w-full max-w-none)
// - 80% backdrop opacity (vs 50% in sidebar)
// - Larger padding (p-6 vs p-4)
// - Smooth width transition (duration-300)

// Sidebar mode:
// - max-w-2xl (or your configured width)
// - Standard backdrop
// - Standard padding
</script>

<template>
  <!-- USlideover with auto-applied slideoverUi -->
  <USlideover v-model="isOpen" :ui="slideoverUi">
    <template #content>
      <!-- Automatically gets correct classes for current mode -->
    </template>
  </USlideover>
</template>
```

### Nested Slideovers

Works with multiple slideover instances:

```vue
<script setup lang="ts">
// Main form
const main = useExpandableSlideover({ maxWidth: '2xl' })

// Nested detail view
const detail = useExpandableSlideover({ maxWidth: 'lg' })

const handleOpenDetail = () => {
  // Main still open and behind
  detail.open(false)
}

const handleCloseDetail = () => {
  detail.close()
  // Back to main form
}
</script>

<template>
  <!-- Main slideover -->
  <USlideover v-model="main.isOpen" side="right" :ui="main.slideoverUi">
    <template #header>
      <h2>Main Form</h2>
    </template>
    
    <template #content>
      <div class="p-6 space-y-4">
        <UButton @click="handleOpenDetail">
          View Details
        </UButton>
      </div>
    </template>
  </USlideover>
  
  <!-- Detail slideover (nested) -->
  <USlideover v-model="detail.isOpen" side="right" :ui="detail.slideoverUi">
    <template #header>
      <h2>Detail View</h2>
    </template>
    
    <template #content>
      <!-- Renders on top of main -->
    </template>
  </USlideover>
</template>
```

### Responsive Behavior

Adjust width based on screen size:

```vue
<script setup lang="ts">
const { windowWidth } = useWindowSize()

// Wider on desktop, narrower on mobile
const maxWidth = computed(() => {
  if (windowWidth.value < 640) return 'sm'
  if (windowWidth.value < 1024) return 'md'
  return '2xl'
})

const slideover = useExpandableSlideover({
  maxWidth: maxWidth.value
})
</script>
```

### Best Practices

**DO:**
- ✅ Use for complex forms with lots of content
- ✅ Provide expand button for better UX
- ✅ Handle close animations before heavy operations
- ✅ Show appropriate tooltips for expand/collapse
- ✅ Use consistent maxWidth across app

**DON'T:**
- ❌ Nest more than 2 levels deep (gets confusing)
- ❌ Auto-expand on small screens (sidebar better for mobile)
- ❌ Force fullscreen if not needed (sidebar is usually fine)
- ❌ Mix with modal overlays (stick to slideovers)

### Troubleshooting

| Issue | Solution |
|-------|----------|
| Expand button doesn't appear | Check `slideoverUi` passed to USlideover, verify Lucide icons available |
| Width doesn't change on toggle | Verify `transition-[max-width]` Tailwind directive enabled |
| Animation feels jerky | Check no CSS conflicts, ensure `duration-300` applied |
| Backdrop too dark/light | Adjust `bg-gray-900/80` and `backdrop-blur-sm` in slideoverUi |

---


## Related Resources

- [Internationalization Guide](/features/internationalization) - Translation system
- [Asset Management Guide](/features/assets) - File upload and management
- [Nuxt Composables](https://nuxt.com/docs/guide/directory-structure/composables) - Nuxt composables guide
