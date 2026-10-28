---
title: Form Components
description: Interactive form elements for data input with validation and dynamic behavior
icon: i-lucide-file-text
---

## CroutonForm

The main orchestrator component that manages form instances in different container types (modals, dialogs, slideovers). This component is automatically registered globally and renders based on state managed by `useCrouton()`.

### Container Types

| Type | Use Case | Features |
|------|----------|----------|
| **Modal** | Standard forms | Centered dialog, backdrop, size: `lg` |
| **Dialog** | Simple confirmations | Like modal but without body wrapper padding |
| **Slideover** | Complex forms, nested editing | Side panel, expandable, supports 5-level nesting |

### Opening Forms

Forms are opened programmatically using the `useCrouton()` composable:

```vue
<script setup lang="ts">
const { open } = useCrouton()

// Create new item in slideover (default)
const handleCreate = () => {
  open('create', 'users', [])
}

// Update item in modal
const handleEdit = (id: string) => {
  open('update', 'users', [id], 'modal')
}

// Delete confirmation in dialog
const handleDelete = (ids: string[]) => {
  open('delete', 'users', ids, 'dialog')
}

// View-only mode
const handleView = (id: string) => {
  open('view', 'users', [id])
}
</script>

<template>
  <UButton @click="handleCreate">Create User</UButton>
  <UButton @click="handleEdit('user-123')">Edit User</UButton>
  <UButton @click="handleDelete(['user-1', 'user-2'])">Delete Users</UButton>
</template>
```

### Slideover Nesting & Expansion

Slideovers support up to **5 levels of nesting** for complex workflows like editing a product → adding a category → adding a tag.

#### Nesting Example

```vue
<script setup lang="ts">
const { open } = useCrouton()

// Level 1: Edit product
open('update', 'products', ['product-123'])

// Inside product form, user clicks "Add Category"
// Level 2: Create category (nested)
open('create', 'categories', [])

// Inside category form, user clicks "Add Parent Category"
// Level 3: Create parent category (nested deeper)
open('create', 'categories', [])
</script>
```

**Visual Stacking**: Each nested slideover has a cascading offset for visual clarity:
- Level 1: No offset
- Level 2: Offset right
- Level 3: Offset more, etc.

**Breadcrumb Navigation**: Nested slideovers show breadcrumbs indicating the parent context.

#### Expand/Collapse

Slideovers can toggle between sidebar mode (max-w-2xl) and fullscreen:

```vue
<!-- Expand button appears in slideover header -->
<!-- Click to toggle between: -->
<!-- Sidebar: max-w-2xl with padding -->
<!-- Fullscreen: Full width, more workspace -->
```

**Transition**: Smooth 400ms CSS transition with proper cleanup.

### State Management

Forms use the `CroutonState` interface for internal state:

```typescript
interface CroutonState {
  id: string                          // Unique state ID
  action: CroutonAction              // 'create' | 'update' | 'delete' | 'view'
  collection: string | null           // Collection name
  activeItem: any                     // Item being edited/viewed
  items: any[]                        // Items for batch delete
  loading: LoadingState              // Loading state per action
  isOpen: boolean                     // Container open state
  containerType: 'slideover' | 'modal' | 'dialog' | 'inline'
  isExpanded?: boolean               // Slideover expand state
}
```

### Events

| Event | Trigger | Purpose |
|-------|---------|---------|
| `@update:open` | Container close | Handles cleanup when form closes |
| `@after:leave` | Animation complete | Removes state after transition ends |

### Complete Example

```vue
<!-- No manual template needed - Form renders globally -->

<script setup lang="ts">
const { open, close } = useCrouton()

// Open form
const createProduct = () => {
  open('create', 'products', [], 'slideover')
}

// Forms close automatically after successful submission
// Or close manually:
const cancelForm = () => {
  close()
}
</script>

<template>
  <div>
    <UButton @click="createProduct">
      <UIcon name="i-lucide-plus" />
      Create Product
    </UButton>
  </div>
</template>
```

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Escape` | Close current form/slideover |
| *(Future)* Expand/collapse shortcut | Not yet implemented |

### Troubleshooting

#### Form doesn't open

1. **Check collection name**: Must match configured collection
2. **Check component exists**: Run generator to create form component
3. **Check console**: Look for resolution errors

#### Nested slideovers feel confusing

1. **Limit nesting**: Consider alternative UX for >3 levels
2. **Use breadcrumbs**: Shows context path
3. **Use modal for simple edits**: Clearer separation

#### Multiple forms open at once

This is expected! You can have:
- 1 modal + 1 slideover
- 5 nested slideovers (max depth)
- Multiple dialogs (avoid this)

Each has independent state managed by `useCrouton()`.

---


---

## FormDynamicLoader

Dynamically resolves and loads the correct form component for a given collection. Used internally by `CroutonForm` to display collection-specific forms.

::callout{icon="i-lucide-info" color="blue"}
**Internal Component**: You typically don't use this directly. It's used by `CroutonForm` to load generated form components.
::

### Props

```typescript
interface FormDynamicLoaderProps {
  collection: string        // Collection name (e.g., 'users')
  loading: string          // Loading state: 'create' | 'update' | 'delete' | ''
  action: string           // Action type: 'create' | 'update' | 'delete' | 'view'
  items: any[]             // Items for delete action
  activeItem: any          // Item for update/view
}
```

### Component Resolution

The loader computes the component name from the collection key and loads it lazily from a build-time map (no registry lookup):

```typescript
// Collection key `shopProducts` → canonical name `ShopProducts`
// view   → ShopProductsDetail → CroutonDetail → ShopProductsForm
// others → ShopProductsForm
```

A component of that name in the app's `app/components` wins over the generated or package one. See [Replace a form or list](/customization/eject).

### Convention: Detail vs Form Components

| Action | Component Loaded | Convention |
|--------|-----------------|------------|
| `create` | `[Collection]Form.vue` | e.g., `UsersForm.vue` |
| `update` | `[Collection]Form.vue` | e.g., `UsersForm.vue` |
| `delete` | `[Collection]Form.vue` | Confirmation UI |
| `view` | `[Collection]Detail.vue` **OR** `[Collection]Form.vue` | Detail first, fallback to Form |

**Example**:
```bash
components/
├── UsersForm.vue        # Create/Update/Delete
└── UsersDetail.vue      # View-only (optional)
```

### Mode Detection

For special collections like `translationsUi`:

```typescript
// Detects mode based on route path
const mode = computed(() => {
  const route = useRoute()
  if (route.path.includes('/super-admin/')) {
    return 'system'  // System-level translations
  }
  return 'team'      // Team-level translations
})
```

### Usage (Internal)

```vue
<!-- Used by _Form.vue -->
<FormDynamicLoader
  :collection="state.collection"
  :loading="state.loading"
  :action="state.action"
  :items="state.items"
  :activeItem="state.activeItem"
/>
```

### Troubleshooting

#### "Component not found" error

1. **Run generator**: `npx crouton-generate config crouton.config.js`
2. **Check naming**: Must be `[Collection]Form.vue` (PascalCase)
3. **Check registration**: Component must be in `components/` directory

#### Detail component not loading for 'view' action

1. **Create Detail component**: `components/[Collection]Detail.vue`
2. **Register in componentMap**: Generator handles this automatically
3. **Fallback works**: Form component shows if Detail is missing

---


---

## FormLayout

Responsive layout wrapper for forms with tabs, sidebar, and header/footer slots. Provides consistent structure for complex forms with validation error indicators.

### Props

```typescript
interface FormLayoutProps {
  tabs?: boolean                      // Enable tab navigation (default: false)
  navigationItems?: NavigationItem[]  // Tab definitions
  tabErrors?: Record<string, number>  // Error counts per tab
  modelValue?: string                 // Active tab (v-model)
}

interface NavigationItem {
  label: string        // Tab label
  value: string        // Tab value/ID
  icon?: string        // Optional icon
}
```

### Slots

| Slot | Scoped Props | Purpose |
|------|--------------|---------|
| `header` | - | Form header content (title, actions) |
| `main` | `{ activeSection }` | Primary form fields (receives active tab) |
| `sidebar` | - | Meta fields, settings (responsive accordion on mobile) |
| `footer` | - | Submit button, validation summary, action buttons |

### Basic Usage

```vue
<template>
  <CroutonFormLayout>
    <template #header>
      <h2 class="text-2xl font-bold">Create Product</h2>
    </template>

    <template #main>
      <div class="space-y-6">
        <UFormField label="Name" name="name">
          <UInput v-model="state.name" />
        </UFormField>

        <UFormField label="Price" name="price">
          <UInput v-model="state.price" type="number" />
        </UFormField>
      </div>
    </template>

    <template #footer>
      <CroutonFormActionButton
        :action="action"
        :collection="collection"
      />
    </template>
  </CroutonFormLayout>
</template>
```

### Tab Navigation

Enable tabs for organizing complex forms.

#### Basic Tab Setup

```vue
<script setup lang="ts">
const activeSection = ref('general')

const navigationItems = [
  { label: 'General', value: 'general', icon: 'i-lucide-info' },
  { label: 'Pricing', value: 'pricing', icon: 'i-lucide-dollar-sign' },
  { label: 'SEO', value: 'seo', icon: 'i-lucide-search' }
]
</script>

<template>
  <CroutonFormLayout
    :tabs="true"
    :navigation-items="navigationItems"
    v-model="activeSection"
  >
    <template #main="{ activeSection }">
      <div v-show="activeSection === 'general'" class="space-y-6">
        <UFormField label="Name" name="name">
          <UInput v-model="state.name" />
        </UFormField>
      </div>

      <div v-show="activeSection === 'pricing'" class="space-y-6">
        <UFormField label="Price" name="price">
          <UInput v-model="state.price" type="number" />
        </UFormField>
      </div>
    </template>
  </CroutonFormLayout>
</template>
```

#### Tracking Validation Errors Per Tab

```vue
<script setup lang="ts">
const validationErrors = ref([])

// Map fields to their tab groups
const fieldToGroup: Record<string, string> = {
  'name': 'general',
  'description': 'general',
  'price': 'pricing',
  'compareAtPrice': 'pricing',
  'metaTitle': 'seo',
  'metaDescription': 'seo'
}

// Count errors per tab
const tabErrorCounts = computed(() => {
  const counts: Record<string, number> = {}
  validationErrors.value.forEach((error: any) => {
    const tabName = fieldToGroup[error.name] || 'general'
    counts[tabName] = (counts[tabName] || 0) + 1
  })
  return counts
})

const handleValidationError = (event: any) => {
  if (event?.errors) {
    validationErrors.value = event.errors
  }
}
</script>

<template>
  <UForm @error="handleValidationError">
    <CroutonFormLayout
      :tabs="true"
      :tab-errors="tabErrorCounts"
    >
      <!-- ... -->
    </CroutonFormLayout>
  </UForm>
</template>
```

#### Error Summary with Tab Navigation

Combine tab navigation with error summary in the footer:

```vue
<template>
  <CroutonFormLayout :tabs="true">
    <template #footer>
      <CroutonValidationErrorSummary
        :tab-errors="tabErrorCounts"
        :navigation-items="navigationItems"
        @switch-tab="activeSection = $event"
      />

      <CroutonFormActionButton
        :action="action"
        :collection="collection"
      />
    </template>
  </CroutonFormLayout>
</template>
```

### Error Indicators

Tabs automatically show error badges when validation fails:

```vue
<!-- Error badge appears as red dot with count -->
<UTabs :items="enhancedNavigationItems">
  <!-- General (2) ← Shows 2 errors -->
  <!-- Pricing ← No errors -->
  <!-- SEO (1) ← Shows 1 error -->
</UTabs>
```

### Responsive Sidebar

The sidebar adapts to screen size:

| Breakpoint | Behavior |
|------------|----------|
| **Mobile** (`< lg`) | Accordion at top of form |
| **Desktop** (`>= lg`) | Fixed sidebar column on right |

```vue
<template>
  <CroutonFormLayout>
    <template #main>
      <!-- Primary fields -->
    </template>

    <template #sidebar>
      <!-- Meta settings, status, timestamps, etc. -->
      <div class="space-y-4">
        <UFormField label="Status" name="status">
          <USelectMenu v-model="state.status" :items="statusOptions" />
        </UFormField>

        <UFormField label="Published At" name="publishedAt">
          <CroutonDate v-model="state.publishedAt" />
        </UFormField>
      </div>
    </template>
  </CroutonFormLayout>
</template>
```

### Complete Example: Product Form with All Features

For a complete working example demonstrating a multi-tab product form with validation tracking, error summary, and all CroutonFormLayout features, see this interactive demo:

::callout{type="info" icon="i-lucide-code"}
**[View Full Interactive Demo →](https://stackblitz.com/edit/nuxt-crouton-product-form)**

Fork the demo to experiment with different configurations. The complete example includes:
- Multi-tab layout (General, Pricing, Organization, SEO)
- Per-tab validation error tracking
- Reference selects for categories and tags
- Date picker integration
- Full CRUD operations (create/update)
- Validation error summary component
::

#### Focused Example: Tab Error Tracking

This snippet shows the key pattern for tracking validation errors per tab:

```vue
<script setup lang="ts">
const { create, update } = useCollectionMutation('products')
const activeSection = ref('general')

const navigationItems = [
  { label: 'General', value: 'general', icon: 'i-lucide-info' },
  { label: 'Pricing', value: 'pricing', icon: 'i-lucide-dollar-sign' },
  { label: 'Organization', value: 'organization', icon: 'i-lucide-folder' },
  { label: 'SEO', value: 'seo', icon: 'i-lucide-search' }
]

// Map fields to their tab groups
const fieldToGroup: Record<string, string> = {
  'name': 'general',
  'description': 'general',
  'price': 'pricing',
  'compareAtPrice': 'pricing',
  'categoryId': 'organization',
  'tags': 'organization',
  'metaTitle': 'seo',
  'metaDescription': 'seo'
}

// Count errors per tab
const tabErrorCounts = computed(() => {
  const counts: Record<string, number> = {}
  validationErrors.value.forEach((error: any) => {
    const tabName = fieldToGroup[error.name] || 'general'
    counts[tabName] = (counts[tabName] || 0) + 1
  })
  return counts
})
</script>

<template>
  <UForm :state="state" :schema="schema" @submit="handleSubmit">
    <CroutonFormLayout
      :tabs="true"
      :navigation-items="navigationItems"
      :tab-errors="tabErrorCounts"
      v-model="activeSection"
    >
      <!-- Tab content sections... -->
      <template #footer>
        <CroutonValidationErrorSummary
          :tab-errors="tabErrorCounts"
          :navigation-items="navigationItems"
          @switch-tab="activeSection = $event"
        />
      </template>
    </CroutonFormLayout>
  </UForm>
</template>
```

### Customization

#### Custom Max Width

```vue
<!-- Default: max-w-7xl -->
<CroutonFormLayout class="max-w-5xl">
  <!-- ... -->
</CroutonFormLayout>
```

#### Custom Sidebar Label (Mobile)

Currently hardcoded as "Meta settings". To customize:

```vue
<!-- Feature request: Make configurable -->
<!-- Workaround: Hide sidebar on mobile, use tabs instead -->
```

### Troubleshooting

#### Sidebar not showing

1. **Check slot usage**: Must use `#sidebar` slot
2. **Check content**: Sidebar must have content
3. **Check breakpoint**: Only visible on `lg` and up

#### Tabs not working

1. **Check `tabs` prop**: Must be `true`
2. **Check `navigation-items`**: Must have 2+ items
3. **Check v-show**: Use `v-show` not `v-if` for tab content

#### Error badges not appearing

1. **Check `tab-errors` prop**: Must be reactive object
2. **Check field mapping**: Ensure `fieldToGroup` maps all fields
3. **Check validation**: Errors must be captured via `@error` event

---


---

## FormReferenceSelect

A smart dropdown component for selecting related entities from other collections. Supports both single and multi-select modes, inline creation, and comprehensive error handling.

::callout{icon="i-lucide-info" color="blue"}
**Component Name**: The actual component is `CroutonFormReferenceSelect` but is typically referenced as just `FormReferenceSelect` or auto-aliased as `ReferenceSelect` in generated forms.
::

### Props

```typescript
interface FormReferenceSelectProps {
  modelValue: string | string[] | null  // Selected ID(s)
  collection: string                     // Collection to fetch from
  label?: string                         // Display label
  labelKey?: string                      // Field to use as label (default: 'title')
  filterFields?: string[]                // Fields to search (default: ['title', 'name'])
  hideCreate?: boolean                   // Hide "Create new" button (default: false)
  multiple?: boolean                     // Multi-select mode (default: false)
}
```

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `modelValue` | `string \| string[] \| null` | *required* | Selected item ID(s) - array for multiple mode |
| `collection` | `string` | *required* | Collection name to fetch options from |
| `label` | `string` | `collection` | Display label for the field |
| `labelKey` | `string` | `'title'` | Field to display as option label |
| `filterFields` | `string[]` | `['title', 'name']` | Fields to search across |
| `hideCreate` | `boolean` | `false` | Hide inline create button |
| `multiple` | `boolean` | `false` | Enable multi-select mode |

### Events

```typescript
@update:modelValue="handleUpdate"  // Emits: string | string[] | null
```

### Basic Usage (Single Select)

Automatically generated for fields with `refTarget` in the schema:

```vue
<template>
  <UFormField label="Author" name="authorId">
    <CroutonFormReferenceSelect
      v-model="state.authorId"
      collection="authors"
      label="Author"
    />
  </UFormField>
</template>

<script setup lang="ts">
const state = ref({
  authorId: null,  // Will contain selected author ID
  title: '',
  content: ''
})
</script>
```

### Multi-Select Mode

Enable multi-select for many-to-many relationships:

```vue
<template>
  <UFormField label="Tags" name="tags">
    <CroutonFormReferenceSelect
      v-model="state.tags"
      collection="tags"
      label="Tags"
      :multiple="true"
    />
  </UFormField>
</template>

<script setup lang="ts">
const state = ref({
  title: '',
  tags: []  // Will contain array of tag IDs: ['tag-1', 'tag-2', 'tag-3']
})
</script>
```

### Custom Label and Filter Fields

Customize which field displays and which fields are searchable:

```vue
<template>
  <UFormField label="Category" name="categoryId">
    <CroutonFormReferenceSelect
      v-model="state.categoryId"
      collection="categories"
      label="Category"
      label-key="name"
      :filter-fields="['name', 'description', 'slug']"
    />
  </UFormField>
</template>
```

### Inline Creation

Click the "+" button in the dropdown to create a new item inline. The newly created item is automatically selected.

```vue
<!-- "Create new" button appears in dropdown by default -->
<CroutonFormReferenceSelect
  v-model="state.categoryId"
  collection="categories"
  label="Category"
/>

<!-- Hide create button if you don't want inline creation -->
<CroutonFormReferenceSelect
  v-model="state.categoryId"
  collection="categories"
  label="Category"
  :hide-create="true"
/>
```

**User Flow**:
1. User clicks dropdown → sees available items
2. User types to search → results filtered in real-time
3. User clicks **"+ Create new"** button → nested slideover opens
4. User fills form and saves → slideover closes
5. **Newly created item is auto-selected** → form continues

### Error Handling

FormReferenceSelect provides user-friendly error messages for common scenarios:

```vue
<!-- Component handles these errors automatically -->
```

| Status Code | Error Message | Cause |
|-------------|---------------|-------|
| **404** | "The [collection] collection could not be found" | Collection doesn't exist |
| **403** | "You don't have permission to view [collection]" | Authorization failed |
| **500+** | "There was a problem loading the data. Please try again." | Server error |

**Visual Feedback**:
- Error alert appears above dropdown
- Dropdown is disabled when error occurs
- Alert includes icon and descriptive message

### Usage Examples

#### Single Select

```vue
<script setup lang="ts">
const state = ref({ authorId: null })
</script>

<template>
  <UFormField label="Author" name="authorId">
    <CroutonFormReferenceSelect
      v-model="state.authorId"
      collection="users"
      label="Author"
      label-key="fullName"
      :filter-fields="['fullName', 'email']"
    />
  </UFormField>
</template>
```

#### Multi-Select

```vue
<script setup lang="ts">
const state = ref({ tags: [] })
</script>

<template>
  <UFormField label="Tags" name="tags">
    <CroutonFormReferenceSelect
      v-model="state.tags"
      collection="tags"
      label="Tags"
      :multiple="true"
    />
  </UFormField>
</template>
```

#### Hide Create Button

Prevent users from creating new items:

```vue
<template>
  <CroutonFormReferenceSelect
    v-model="state.categoryId"
    collection="categories"
    label="Category"
    :hide-create="true"
  />
</template>
```

#### Custom Filter Fields

Search across multiple fields:

```vue
<template>
  <CroutonFormReferenceSelect
    v-model="state.relatedPosts"
    collection="posts"
    label="Related Posts"
    :multiple="true"
    :filter-fields="['title', 'excerpt']"
  />
</template>
```

### Features

- ✅ **Searchable dropdown** - Full-text search across specified fields
- ✅ **Loading states** - Skeleton UI while fetching items
- ✅ **Inline creation** - "+" button opens nested form for quick creation
- ✅ **Auto-selection** - Newly created items automatically selected
- ✅ **Multi-select** - Support for many-to-many relationships
- ✅ **Error handling** - User-friendly messages for 404/403/500 errors
- ✅ **Lazy loading** - Items fetched on demand via `useCollectionQuery`
- ✅ **Instance isolation** - Local state prevents cross-contamination

### Troubleshooting

#### Dropdown shows "undefined" for labels

1. **Check `labelKey` prop**: Must match a field in the collection
2. **Check data**: Ensure items have the specified label field
3. **Fallback chain**: Component tries `labelKey` → `title` → `name` → `id`

#### Create button not working

1. **Check permissions**: User must have create permission for collection
2. **Check form component**: Collection must have a generated form component
3. **Check generator**: Run `npx crouton-generate config crouton.config.js` if forms are missing

#### Newly created item not auto-selected

This is handled automatically. If not working:
1. **Check return value**: API must return created item with `id`
2. **Check array length**: Component watches `items.length` for changes
3. **Check console**: Look for errors during creation

#### Multi-select not working

1. **Check `multiple` prop**: Must be `true`
2. **Check `modelValue` type**: Must be array, not string
3. **Initialize as array**: `tags: []` not `tags: null`

---


---

## CroutonAssetsPicker

Browse and select from a centralized asset library. Part of the `@fyit/crouton-assets` package.

### Props

```typescript
interface CroutonAssetsPickerProps {
  modelValue?: string              // Selected asset ID (v-model)
  collection?: string              // Assets collection name (default: 'assets')
}
```

### Basic Usage

```vue
<template>
  <UFormField label="Featured Image" name="imageId">
    <CroutonAssetsPicker v-model="state.imageId" />
  </UFormField>
</template>

<script setup lang="ts">
const state = ref({
  imageId: ''
})
</script>
```

### In Schema Definition

Use in your collection schema with `refTarget` - the component is **auto-detected**:

```json
{
  "imageId": {
    "type": "string",
    "refTarget": "assets",
    "meta": {
      "label": "Featured Image"
      // Component automatically detected as CroutonAssetsPicker!
    }
  }
}
```

### Features

- **Grid view** - Visual thumbnail grid of all assets
- **Search** - Real-time search by filename or alt text
- **Upload new** - Quick upload button opens uploader modal
- **Auto-refresh** - Automatically updates after new uploads
- **Team-scoped** - Shows only assets for current team
- **Loading states** - Skeleton UI while fetching assets

### Complete Example

```vue
<template>
  <div class="space-y-4">
    <!-- Asset picker with preview -->
    <UFormField label="Header Image" name="headerId">
      <CroutonAssetsPicker v-model="state.headerId" />
    </UFormField>

    <!-- Display selected asset URL -->
    <div v-if="state.headerId">
      <img :src="selectedAssetUrl" alt="Selected header" class="w-full rounded-lg" />
    </div>
  </div>
</template>

<script setup lang="ts">
const state = ref({
  headerId: ''
})

// Fetch selected asset details
const { data: selectedAsset } = await useFetch(
  `/api/teams/${useRoute().params.team}/assets/${state.headerId}`,
  { watch: [() => state.headerId] }
)

const selectedAssetUrl = computed(() =>
  selectedAsset.value?.pathname ? `/images/${selectedAsset.value.pathname}` : ''
)
</script>
```

---


---

## CroutonAssetUploader

Upload files with metadata to the centralized asset library. Part of the `@fyit/crouton-assets` package.

### Props

```typescript
interface CroutonAssetUploaderProps {
  collection?: string              // Assets collection name (default: 'assets')
}
```

### Events

```typescript
@uploaded="handleUploaded"        // Emits: string (new asset ID)
```

### Basic Usage

```vue
<template>
  <UModal v-model="showUploader">
    <template #content="{ close }">
      <div class="p-6">
        <h3 class="text-lg font-semibold mb-4">Upload New Asset</h3>
        <CroutonAssetUploader @uploaded="handleUploaded(close)" />
      </div>
    </template>
  </UModal>
</template>

<script setup lang="ts">
const showUploader = ref(false)

const handleUploaded = async (close: () => void, assetId: string) => {
  console.log('New asset created:', assetId)
  close()
}
</script>
```

### Features

- **File preview** - Shows preview after file selection
- **Alt text input** - Accessibility and SEO metadata
- **File metadata** - Displays filename, size, and MIME type
- **Two-step upload** - Uploads to blob storage then creates database record
- **Loading states** - Shows progress during upload
- **Auto-emit** - Emits new asset ID on successful upload

### Metadata Collected

- `filename` - Original filename
- `pathname` - Blob storage path
- `contentType` - MIME type
- `size` - File size in bytes
- `alt` - Alt text for accessibility
- `uploadedAt` - Upload timestamp
- `teamId` - Team/organization ownership
- `userId` - User who uploaded

---


---

## Calendar

Interactive date picker component for selecting single dates or date ranges. Wraps Nuxt UI's `<UCalendar>` with timezone-aware date handling. Part of the base `@fyit/crouton-core` package.

::callout{icon="i-lucide-info" color="blue"}
**Timezone Handling**: Calendar uses `@internationalized/date` library to handle timezone conversions transparently. You can pass JavaScript `Date` objects or timestamps (numbers), and the component handles the rest.
::

### Props

```typescript
interface CalendarProps {
  // Single Date Mode
  date?: Date | number | null       // Date or timestamp for single date

  // Range Mode
  range?: boolean                   // Enable range selection
  startDate?: Date | number | null  // Start date or timestamp for range
  endDate?: Date | number | null    // End date or timestamp for range

  // Constraints
  minDate?: Date | number | null    // Min selectable date or timestamp
  maxDate?: Date | number | null    // Max selectable date or timestamp
  isDateDisabled?: (date: Date) => boolean  // Function to disable specific dates

  // UI Customization
  color?: 'primary' | 'secondary' | 'success' | 'info' | 'warning' | 'error' | 'neutral'
  variant?: 'solid' | 'outline' | 'soft' | 'subtle'
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl'
  ui?: Record<string, unknown>      // Passthrough UI customization to UCalendar

  // Controls
  disabled?: boolean                // Disable selection
  monthControls?: boolean           // Show month navigation (default: true)
  yearControls?: boolean            // Show year navigation (default: true)
  numberOfMonths?: number           // Number of months to display
}
```

#### Prop Details

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `date` | `Date \| number \| null` | `null` | Current date value (single mode) |
| `range` | `boolean` | `false` | Enable date range selection |
| `startDate` | `Date \| number \| null` | `null` | Range start date |
| `endDate` | `Date \| number \| null` | `null` | Range end date |
| `minDate` | `Date \| number \| null` | `null` | Minimum selectable date |
| `maxDate` | `Date \| number \| null` | `null` | Maximum selectable date |
| `isDateDisabled` | `(date: Date) => boolean` | `undefined` | Function to disable specific dates |
| `color` | `string` | `'primary'` | Color theme |
| `variant` | `string` | `'solid'` | Visual style variant |
| `size` | `string` | `'md'` | Component size |
| `ui` | `Record<string, unknown>` | `undefined` | Passthrough UI customization to UCalendar |
| `disabled` | `boolean` | `false` | Disable date selection |
| `monthControls` | `boolean` | `true` | Show month navigation arrows |
| `yearControls` | `boolean` | `true` | Show year dropdown |
| `numberOfMonths` | `number` | Auto | Months to display (auto: 1 for single, 2 for range) |

### Slots

| Slot | Props | Description |
|------|-------|-------------|
| `day` | `{ day: DateValue, date: Date }` | Custom rendering for each day cell |

The `#day` slot receives both the raw `DateValue` from `@internationalized/date` and a converted JavaScript `Date` object for convenience.

### Events

```typescript
{
  'update:date': [value: Date | null]        // Single date changed
  'update:startDate': [value: Date | null]   // Range start changed
  'update:endDate': [value: Date | null]     // Range end changed
}
```

### Usage Examples

#### Single Date Picker

```vue
<template>
  <div>
    <h3 class="font-semibold mb-2">Select Event Date</h3>
    <Calendar
      v-model:date="eventDate"
      :min-date="new Date()"
      color="primary"
    />
    <p v-if="eventDate" class="mt-2 text-sm">
      Selected: {{ eventDate.toLocaleDateString() }}
    </p>
  </div>
</template>

<script setup lang="ts">
const eventDate = ref<Date | null>(null)
</script>
```

#### Date Range Picker

```vue
<template>
  <div>
    <h3 class="font-semibold mb-2">Select Booking Period</h3>
    <Calendar
      range
      v-model:start-date="startDate"
      v-model:end-date="endDate"
      :min-date="new Date()"
      :number-of-months="2"
      color="success"
    />
    <div v-if="startDate && endDate" class="mt-2 text-sm">
      <p>Check-in: {{ startDate.toLocaleDateString() }}</p>
      <p>Check-out: {{ endDate.toLocaleDateString() }}</p>
      <p>Nights: {{ calculateNights(startDate, endDate) }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
const startDate = ref<Date | null>(null)
const endDate = ref<Date | null>(null)

const calculateNights = (start: Date, end: Date) => {
  return Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24))
}
</script>
```

#### With Date Constraints

```vue
<template>
  <div>
    <h3 class="font-semibold mb-2">Select Appointment Date</h3>
    <Calendar
      v-model:date="appointmentDate"
      :min-date="minDate"
      :max-date="maxDate"
      :disabled="isLoading"
      variant="outline"
    />
  </div>
</template>

<script setup lang="ts">
const appointmentDate = ref<Date | null>(null)
const isLoading = ref(false)

// Only allow dates within next 30 days
const minDate = computed(() => new Date())
const maxDate = computed(() => {
  const date = new Date()
  date.setDate(date.getDate() + 30)
  return date
})
</script>
```

#### Using Timestamps

```vue
<template>
  <div>
    <Calendar
      v-model:date="publishTimestamp"
      :min-date="Date.now()"
    />
  </div>
</template>

<script setup lang="ts">
// Can work with timestamps instead of Date objects
const publishTimestamp = ref<number | null>(null)

watchEffect(() => {
  if (publishTimestamp.value) {
    console.log('Publish at:', new Date(publishTimestamp.value))
  }
})
</script>
```

#### Disabling Specific Dates

Use the `isDateDisabled` prop to disable specific dates based on custom logic. The function receives a JavaScript `Date` object.

```vue
<template>
  <div>
    <h3 class="font-semibold mb-2">Select Appointment (No Weekends)</h3>
    <Calendar
      v-model:date="appointmentDate"
      :min-date="new Date()"
      :is-date-disabled="isWeekend"
    />
  </div>
</template>

<script setup lang="ts">
const appointmentDate = ref<Date | null>(null)

// Disable weekends
function isWeekend(date: Date): boolean {
  const day = date.getDay()
  return day === 0 || day === 6 // Sunday = 0, Saturday = 6
}
</script>
```

You can also combine multiple conditions:

```vue
<script setup lang="ts">
// Disable weekends and specific dates (e.g., holidays)
const holidays = [
  new Date('2024-12-25'),
  new Date('2024-12-26'),
  new Date('2025-01-01')
]

function isDateDisabled(date: Date): boolean {
  // Check weekends
  const day = date.getDay()
  if (day === 0 || day === 6) return true

  // Check holidays
  return holidays.some(h =>
    h.getFullYear() === date.getFullYear() &&
    h.getMonth() === date.getMonth() &&
    h.getDate() === date.getDate()
  )
}
</script>
```

#### Custom Day Rendering

Use the `#day` slot to customize how each day cell is rendered. The slot provides both the raw `DateValue` and a converted JavaScript `Date`.

```vue
<template>
  <Calendar v-model:date="selectedDate" :min-date="new Date()">
    <template #day="{ day, date }">
      <div class="relative w-full h-full flex items-center justify-center">
        <!-- Day number -->
        <span>{{ day.day }}</span>

        <!-- Show indicator for dates with bookings -->
        <span
          v-if="hasBooking(date)"
          class="absolute bottom-0.5 w-1.5 h-1.5 bg-primary rounded-full"
        />
      </div>
    </template>
  </Calendar>
</template>

<script setup lang="ts">
const selectedDate = ref<Date | null>(null)

// Example: dates with existing bookings
const bookedDates = [
  new Date('2024-12-15'),
  new Date('2024-12-20'),
  new Date('2024-12-25')
]

function hasBooking(date: Date): boolean {
  return bookedDates.some(b =>
    b.getFullYear() === date.getFullYear() &&
    b.getMonth() === date.getMonth() &&
    b.getDate() === date.getDate()
  )
}
</script>
```

#### UI Customization

Pass custom styling to the underlying UCalendar using the `ui` prop:

```vue
<template>
  <Calendar
    v-model:date="selectedDate"
    :ui="{
      body: 'p-4',
      day: 'rounded-full',
      daySelected: 'bg-primary text-white'
    }"
  />
</template>
```

#### In Forms

```vue
<template>
  <UForm :state="state" :schema="schema" @submit="onSubmit">
    <UFormField label="Event Date" name="eventDate" required>
      <Calendar
        v-model:date="state.eventDate"
        :min-date="new Date()"
      />
    </UFormField>

    <UFormField label="Booking Period" name="dateRange" required>
      <Calendar
        range
        v-model:start-date="state.startDate"
        v-model:end-date="state.endDate"
        :min-date="new Date()"
      />
    </UFormField>

    <UButton type="submit">Submit</UButton>
  </UForm>
</template>

<script setup lang="ts">
import { z } from 'zod'

const schema = z.object({
  eventDate: z.date().min(new Date(), 'Date must be in the future'),
  startDate: z.date(),
  endDate: z.date()
}).refine(
  data => data.endDate > data.startDate,
  { message: 'End date must be after start date', path: ['endDate'] }
)

const state = ref({
  eventDate: null as Date | null,
  startDate: null as Date | null,
  endDate: null as Date | null
})

const onSubmit = (data: any) => {
  console.log('Form submitted:', data)
}
</script>
```

### Features

- **Dual Mode Support**: Single date or date range selection
- **Flexible Input**: Accepts both `Date` objects and timestamps (numbers)
- **Timezone Aware**: Automatic timezone conversion using `@internationalized/date`
- **Date Constraints**: Min/max date validation with `minDate`/`maxDate`
- **Custom Date Disabling**: Use `isDateDisabled` function to disable specific dates (weekends, holidays, etc.)
- **Custom Day Rendering**: Use `#day` slot for custom day cell content (indicators, badges, etc.)
- **UI Passthrough**: Full customization via `ui` prop passed to underlying UCalendar
- **Auto-detection**: Displays 2 months for range mode, 1 for single mode (configurable)
- **Full Theming**: Complete Nuxt UI 4 theme support (color, variant, size)
- **Navigation Controls**: Optional month and year navigation
- **Disabled State**: Prevent date selection when needed

### Timezone Handling

The component uses `@internationalized/date` to handle timezones correctly:

```typescript
// Internal conversion helpers
function toCalendarDateValue(value: Date | number | null): DateValue {
  const date = value instanceof Date ? value : new Date(value)
  const zonedDateTime = fromDate(date, getLocalTimeZone())
  return toCalendarDate(zonedDateTime)
}

function calendarDateToDate(date: DateValue | null): Date | null {
  if (!date) return null
  return date.toDate(getLocalTimeZone())
}
```

**What this means**:
- You always work with JavaScript `Date` objects or timestamps
- The component handles timezone conversions transparently
- Dates are stored in the user's local timezone
- No need to worry about UTC vs local time

### Auto Month Detection

```vue
<!-- Single mode: Shows 1 month -->
<Calendar v-model:date="date" />

<!-- Range mode: Shows 2 months -->
<Calendar range v-model:start-date="start" v-model:end-date="end" />

<!-- Override: Show 3 months -->
<Calendar range :number-of-months="3" />
```

### Troubleshooting

#### Issue: Date not updating in form

**Problem**: Calendar shows selected date but form state doesn't update

```vue
<!-- ❌ WRONG: Missing v-model:date binding -->
<Calendar :date="state.date" />

<!-- ✅ CORRECT: Use v-model:date for two-way binding -->
<Calendar v-model:date="state.date" />
```

#### Issue: Range selection not working

**Problem**: Only one date is selected in range mode

```vue
<!-- ❌ WRONG: Missing range prop -->
<Calendar
  v-model:start-date="start"
  v-model:end-date="end"
/>

<!-- ✅ CORRECT: Add range prop -->
<Calendar
  range
  v-model:start-date="start"
  v-model:end-date="end"
/>
```

#### Issue: Constraints not working

**Problem**: Users can select dates outside allowed range

```vue
<!-- ❌ WRONG: Using strings for dates -->
<Calendar
  v-model:date="date"
  min-date="2024-01-01"
  max-date="2024-12-31"
/>

<!-- ✅ CORRECT: Use Date objects or timestamps -->
<Calendar
  v-model:date="date"
  :min-date="new Date('2024-01-01')"
  :max-date="new Date('2024-12-31')"
/>
```

#### Issue: TypeScript errors with timestamps

**Problem**: Type mismatch when using timestamps

```typescript
// ❌ WRONG: Type doesn't match
const date = ref<Date>(Date.now())

// ✅ CORRECT: Use union type
const date = ref<Date | number | null>(Date.now())

// ✅ ALSO CORRECT: Convert to Date
const date = ref<Date | null>(new Date())
```

---


---

## CalendarYear

Year calendar view component that displays all 12 months in a responsive grid. Ideal for year-at-a-glance scheduling, availability views, or selecting dates across the entire year. Part of the base `@fyit/crouton-core` package.

::callout{icon="i-lucide-info" color="blue"}
**Year View**: Unlike the standard `Calendar` component which shows 1-2 months, `CalendarYear` displays all 12 months simultaneously in a responsive grid layout.
::

### Props

```typescript
interface CalendarYearProps {
  modelValue?: Date | number | null  // Selected date (v-model)
  year?: number                      // Year to display (default: current year)
  color?: 'primary' | 'secondary' | 'success' | 'info' | 'warning' | 'error' | 'neutral'
  size?: 'xs' | 'sm' | 'md'         // Calendar size (default: 'xs')
}
```

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `modelValue` | `Date \| number \| null` | `null` | Selected date (supports v-model) |
| `year` | `number` | Current year | Year to display |
| `color` | `string` | `'primary'` | Color theme for selected dates |
| `size` | `'xs' \| 'sm' \| 'md'` | `'xs'` | Size of each month calendar |

### Events

| Event | Payload | Description |
|-------|---------|-------------|
| `update:modelValue` | `Date \| null` | Emitted when a date is selected |

### Usage Examples

#### Basic Year View

```vue
<template>
  <CroutonCalendarYear />
</template>
```

#### With Date Selection

```vue
<script setup lang="ts">
const selectedDate = ref<Date | null>(null)
</script>

<template>
  <CroutonCalendarYear v-model="selectedDate" />

  <p v-if="selectedDate">
    Selected: {{ selectedDate.toLocaleDateString() }}
  </p>
</template>
```

#### Specific Year

```vue
<script setup lang="ts">
const selectedDate = ref<Date | null>(null)
const displayYear = ref(2024)
</script>

<template>
  <div class="flex gap-2 mb-4">
    <UButton @click="displayYear--">Previous Year</UButton>
    <span class="font-bold">{{ displayYear }}</span>
    <UButton @click="displayYear++">Next Year</UButton>
  </div>

  <CroutonCalendarYear
    v-model="selectedDate"
    :year="displayYear"
  />
</template>
```

#### With Styling Options

```vue
<template>
  <CroutonCalendarYear
    v-model="selectedDate"
    :year="2025"
    color="neutral"
    size="sm"
  />
</template>
```

### Layout

The component uses a responsive CSS grid:
- **Desktop (lg+)**: 4 columns (3 rows)
- **Tablet (md)**: 3 columns (4 rows)
- **Mobile**: 2 columns (6 rows)

Each month is displayed in its own card with the month name header.

### Notes

- Days from adjacent months are automatically hidden to prevent confusion
- All 12 months share the same selected date state
- The component handles timezone conversions internally using `@internationalized/date`

---

## CroutonDate

Read-only date display component that shows both absolute and relative timestamps. Commonly used in tables, cards, and detail views. Part of the base `@fyit/crouton-core` package.

::callout{icon="i-lucide-triangle-alert" color="amber"}
**Display Only**: This is NOT an input component. For date selection, use `<Calendar>`. This component is for displaying dates in a user-friendly format.
::

### Props

```typescript
interface CroutonDateProps {
  date?: string | Date   // Date to display
}
```

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `date` | `string \| Date` | `undefined` | Date to display (ISO string or Date object) |

### Display Format

The component shows **two** date representations stacked vertically:

1. **Absolute Date** (top): Full formatted date
   - Example: "November 17, 2025, 3:45 PM"
   - Uses Nuxt's `<NuxtTime>` with `style="long"`

2. **Relative Date** (bottom): Time ago format
   - Example: "2 hours ago"
   - Smaller, italicized, semi-transparent (opacity-50)
   - Updates automatically as time passes

### Usage Examples

#### In Table Cells

Most common use case - displaying timestamps in data tables:

```vue
<template>
  <CroutonTable
    :rows="bookings"
    :columns="columns"
    collection="bookings"
  >
    <!-- Custom date display for createdAt -->
    <template #createdAt-cell="{ row }">
      <CroutonDate :date="row.original.createdAt" />
    </template>

    <!-- Custom date display for updatedAt -->
    <template #updatedAt-cell="{ row }">
      <CroutonDate :date="row.original.updatedAt" />
    </template>
  </CroutonTable>
</template>

<script setup lang="ts">
const columns = [
  { accessorKey: 'name', header: 'Name' },
  { accessorKey: 'createdAt', header: 'Created' },
  { accessorKey: 'updatedAt', header: 'Last Updated' }
]

const { data: bookings } = await useFetch('/api/bookings')
</script>
```

#### In Cards

```vue
<template>
  <UCard>
    <template #header>
      <h3 class="font-semibold">{{ booking.title }}</h3>
    </template>

    <div class="space-y-2">
      <div>
        <span class="text-sm text-gray-500">Booking Date:</span>
        <CroutonDate :date="booking.date" />
      </div>

      <div>
        <span class="text-sm text-gray-500">Created:</span>
        <CroutonDate :date="booking.createdAt" />
      </div>
    </div>
  </UCard>
</template>
```

#### In Detail Layouts

```vue
<template>
  <CroutonDetailLayout collection="projects" :item-id="projectId">
    <template #default="{ item }">
      <div class="space-y-4">
        <div>
          <h2 class="text-2xl font-bold">{{ item.name }}</h2>
          <div class="flex gap-4 mt-2 text-sm text-gray-600">
            <div>
              <span class="font-medium">Created:</span>
              <CroutonDate :date="item.createdAt" />
            </div>
            <div>
              <span class="font-medium">Last Updated:</span>
              <CroutonDate :date="item.updatedAt" />
            </div>
          </div>
        </div>

        <!-- Project details -->
      </div>
    </template>
  </CroutonDetailLayout>
</template>
```

#### With ISO Strings

```vue
<template>
  <div>
    <!-- Works with ISO 8601 strings from APIs -->
    <CroutonDate :date="isoTimestamp" />
  </div>
</template>

<script setup lang="ts">
// Common API response format
const isoTimestamp = ref('2025-01-17T15:30:00.000Z')
</script>
```

#### With Date Objects

```vue
<template>
  <div>
    <!-- Works with JavaScript Date objects -->
    <CroutonDate :date="dateObject" />
  </div>
</template>

<script setup lang="ts">
const dateObject = ref(new Date())
</script>
```

### Visual Example

Here's what the component renders:

```
┌─────────────────────────────────┐
│ November 17, 2025, 3:45 PM     │  ← Absolute (normal size, full opacity)
│ 2 hours ago                    │  ← Relative (xs, italic, 50% opacity)
└─────────────────────────────────┘
```

### Features

- **Dual Display**: Shows both absolute and relative time
- **Auto-updates**: Relative time updates automatically (e.g., "2 hours ago" → "3 hours ago")
- **Flexible Input**: Accepts ISO strings or Date objects
- **Internationalized**: Uses `<NuxtTime>` for locale-aware formatting
- **Responsive**: Stacks vertically for clean layout
- **Read-only**: No user interaction, pure display component

### Integration with CroutonTable

The component is commonly used with `CroutonTable` for timestamp columns:

```vue
<template>
  <CroutonTable
    :rows="items"
    :columns="columns"
    collection="items"
  >
    <!-- Default columns (createdAt, updatedAt) automatically use CroutonDate -->
    <!-- Override with custom slot if needed -->
    <template #createdAt-cell="{ row }">
      <div class="flex items-center gap-2">
        <UIcon name="i-lucide-calendar" />
        <CroutonDate :date="row.original.createdAt" />
      </div>
    </template>
  </CroutonTable>
</template>
```

### Troubleshooting

#### Issue: Date not displaying

**Problem**: Component shows empty space

```vue
<!-- ❌ WRONG: Date is undefined or null -->
<CroutonDate :date="undefined" />

<!-- ✅ CORRECT: Check for date before rendering -->
<CroutonDate v-if="item.createdAt" :date="item.createdAt" />

<!-- ✅ ALSO CORRECT: Use optional chaining -->
<CroutonDate :date="item?.createdAt" />
```

#### Issue: Wrong time displayed

**Problem**: Time shows incorrectly (timezone issues)

```typescript
// ❌ WRONG: Storing dates as local strings
const date = '11/17/2025'  // Ambiguous format

// ✅ CORRECT: Use ISO 8601 format
const date = '2025-11-17T15:30:00.000Z'  // UTC timestamp

// ✅ ALSO CORRECT: Use Date objects
const date = new Date()
```

#### Issue: Need different format

**Problem**: Default "long" format is too verbose

```vue
<!-- ❌ LIMITATION: CroutonDate only supports "long" style -->
<CroutonDate :date="date" />

<!-- ✅ WORKAROUND: Use NuxtTime directly for custom formatting -->
<NuxtTime
  :datetime="date"
  numeric="auto"
  style="medium"
/>
```

#### Issue: Relative time not updating

**Problem**: "2 hours ago" never changes

**Solution**: This is handled automatically by `<NuxtTime>`. If not updating, check:
1. Date value is reactive (wrapped in `ref()` or `computed()`)
2. Component is actually mounted in DOM
3. Browser tab is active (may throttle when inactive)

### Comparison: Calendar vs CroutonDate

| Feature | Calendar | CroutonDate |
|---------|----------|-------------|
| **Purpose** | Date selection input | Date display formatter |
| **User Interaction** | ✅ Interactive picker | ❌ Read-only |
| **v-model** | ✅ Yes | ❌ No |
| **Use in Forms** | ✅ Yes | ❌ No (display only) |
| **Use in Tables** | ❌ No | ✅ Yes |
| **Modes** | Single / Range | Display only |
| **Events** | 3 update events | None |
| **Props** | 13 configuration props | 1 prop (date) |

---


---

## CroutonImageUpload

Simple file picker with preview for direct image uploads. Part of the base `@fyit/crouton-core` package.

### Props

```typescript
interface CroutonImageUploadProps {
  modelValue?: string              // Preview URL (v-model)
  accept?: string                  // Accepted file types (default: 'image/*')
  maxSize?: number                 // Max file size in bytes
}
```

### Events

```typescript
@file-selected="handleFile"       // Emits: File | null
```

### Basic Usage

For simple uploads without the asset library:

```vue
<template>
  <div>
    <CroutonImageUpload
      v-model="imageUrl"
      @file-selected="handleUpload"
    />
  </div>
</template>

<script setup lang="ts">
const imageUrl = ref('')

const handleUpload = async (file: File | null) => {
  if (!file) return

  const formData = new FormData()
  formData.append('image', file)

  const pathname = await $fetch('/api/upload-image', {
    method: 'POST',
    body: formData
  })

  imageUrl.value = `/images/${pathname}`
}
</script>
```

### Features

- **File picker** - Click to select or drag-and-drop
- **Preview** - Shows image preview after selection
- **Validation** - File type and size validation
- **Clear button** - Remove selected file

### Use Cases

**Simple approach** - Store URL directly:
```typescript
// Schema
{
  "imageUrl": { "type": "string" }
}
```

**Full asset management** - Use with CroutonAssetPicker:
```typescript
// Schema
{
  "imageId": {
    "type": "string",
    "refTarget": "assets",
    "meta": { "component": "CroutonAssetPicker" }
  }
}
```

---


---

## CroutonAvatarUpload

Specialized variant of CroutonImageUpload for avatar/profile images. Part of the base `@fyit/crouton-core` package.

### Props

Same as `CroutonImageUpload` but with avatar-optimized defaults:

```typescript
interface CroutonAvatarUploadProps {
  modelValue?: string              // Preview URL (v-model)
  accept?: string                  // Default: 'image/png,image/jpeg,image/webp'
  maxSize?: number                 // Default: 2MB
}
```

### Events

```typescript
@file-selected="handleFile"       // Emits: File | null
```

### Basic Usage

```vue
<template>
  <div class="flex items-center gap-4">
    <CroutonAvatarUpload
      v-model="avatarUrl"
      @file-selected="handleAvatarUpload"
    />
    <div>
      <h3>{{ user.name }}</h3>
      <p class="text-sm text-gray-500">Click avatar to change</p>
    </div>
  </div>
</template>

<script setup lang="ts">
const avatarUrl = ref('/default-avatar.png')

const handleAvatarUpload = async (file: File | null) => {
  if (!file) return

  const formData = new FormData()
  formData.append('image', file)

  const pathname = await $fetch('/api/upload-image', {
    method: 'POST',
    body: formData
  })

  avatarUrl.value = `/images/${pathname}`

  // Update user profile
  await $fetch(`/api/users/${user.id}`, {
    method: 'PATCH',
    body: { avatar: pathname }
  })
}
</script>
```

### Features

- **Circular preview** - Avatar-style circular crop preview
- **Size optimization** - Automatically enforces reasonable size limits
- **Format validation** - Accepts common web image formats
- **Responsive** - Works well in profile forms and settings

---


---

## CroutonRepeater

Manage arrays of structured data with add/remove/reorder functionality. Perfect for time slots, contact information, price tiers, and other repeating data patterns.

### Props

```typescript
interface CroutonRepeaterProps {
  modelValue: any[]                // Array of items
  componentName: string            // Name of component to render per item
  addLabel?: string               // Button text (default: "Add Item")
  sortable?: boolean              // Enable drag-to-reorder (default: true)
}
```

### Events

```typescript
@update:modelValue="handleUpdate"  // Emits: any[]
```

### Basic Usage

Automatically generated for fields with `type: "repeater"` in the schema:

```vue
<template>
  <UFormField label="Available Time Slots" name="slots">
    <CroutonRepeater
      v-model="state.slots"
      component-name="Slot"
      add-label="Add Time Slot"
      :sortable="true"
    />
  </UFormField>
</template>

<script setup lang="ts">
const state = ref({
  slots: []
})
</script>
```

### Creating Item Components

You must create a component for each repeater field that defines the structure of a single item:

```vue
<!-- components/Slot.vue -->
<script setup lang="ts">
import { nanoid } from 'nanoid'

interface TimeSlot {
  id: string
  label: string
  startTime: string
  endTime: string
}

const props = defineProps<{
  modelValue: TimeSlot
}>()

const emit = defineEmits<{
  'update:modelValue': [value: TimeSlot]
}>()

// Initialize with defaults
const localValue = computed({
  get: () => props.modelValue || {
    id: nanoid(),
    label: '',
    startTime: '09:00',
    endTime: '17:00'
  },
  set: (val) => emit('update:modelValue', val)
})
</script>

<template>
  <div class="grid grid-cols-4 gap-4">
    <UFormField label="ID" name="id">
      <UInput v-model="localValue.id" disabled class="bg-gray-50" />
    </UFormField>

    <UFormField label="Label" name="label">
      <UInput v-model="localValue.label" />
    </UFormField>

    <UFormField label="Start Time" name="startTime">
      <UInput v-model="localValue.startTime" type="time" />
    </UFormField>

    <UFormField label="End Time" name="endTime">
      <UInput v-model="localValue.endTime" type="time" />
    </UFormField>
  </div>
</template>
```

### Features

- **Add items** - Click button to create new items with auto-generated IDs
- **Remove items** - Click × to delete an item
- **Reorder items** - Drag handle (⋮⋮) to reorder when `sortable: true`
- **Empty state** - Helpful message when no items exist
- **Auto-IDs** - Each item gets unique ID using `nanoid()`

### In Schema Definition

Define repeater fields in your collection schema:

```json
{
  "slots": {
    "type": "repeater",
    "meta": {
      "label": "Available Time Slots",
      "repeaterComponent": "Slot",
      "addLabel": "Add Time Slot",
      "sortable": true,
      "area": "main"
    }
  }
}
```

This generates:
1. JSON/JSONB database column
2. Form field with CroutonRepeater
3. Zod validation `z.array(z.any()).optional()`
4. Default value `[]`

### Item Component Requirements

Your item component must:

1. Accept `modelValue` prop with the item data
2. Emit `update:modelValue` when data changes
3. Provide default values in computed getter
4. Use two-way binding with `v-model`

### Common Use Cases

**Contact Persons**
```vue
<CroutonRepeater
  v-model="state.contacts"
  component-name="ContactPerson"
  add-label="Add Contact"
/>
```

**Price Tiers**
```vue
<CroutonRepeater
  v-model="state.priceTiers"
  component-name="PriceTier"
  add-label="Add Tier"
  :sortable="false"
/>
```

**Social Media Links**
```vue
<CroutonRepeater
  v-model="state.socialLinks"
  component-name="SocialLink"
  add-label="Add Link"
/>
```

### Data Storage

Data is stored as JSON arrays in the database:

```json
{
  "slots": [
    {
      "id": 1697123456789,
      "label": "Morning",
      "startTime": "09:00",
      "endTime": "12:00"
    },
    {
      "id": 1697123456790,
      "label": "Afternoon",
      "startTime": "13:00",
      "endTime": "17:00"
    }
  ]
}
```

::callout{icon="i-lucide-info" color="blue"}
**Drag-to-reorder:** The repeater uses `useSortable` from @vueuse/core for smooth drag-and-drop reordering. This is enabled by default but can be disabled with `:sortable="false"`.
::

::callout{icon="i-lucide-lightbulb" color="amber"}
**When to use:** Use repeater fields when items are tightly coupled to their parent and don't need to be queried independently. For complex relationships or items that need their own table, use reference fields instead.
::

::callout{icon="i-lucide-triangle-alert" color="red"}
**No delete confirmation:** Clicking the remove button (×) immediately deletes the item without confirmation. This is intentional for streamlined UX but means deletions can be accidental. Consider implementing undo functionality or confirmation dialogs for critical data.
::

### Drag-to-Reorder Implementation

The repeater uses VueUse's `useSortable` integration with SortableJS:

```vue
<!-- Drag handle automatically appears when sortable={true} -->
<CroutonRepeater
  v-model="state.items"
  component-name="ItemInput"
  :sortable="true"
/>
```

**Features**:
- **Drag handle**: `i-lucide-grip-vertical` icon (⋮⋮)
- **Ghost class**: Visual feedback during drag
- **Smooth animations**: CSS transitions for reordering
- **Touch support**: Works on mobile devices

**Disable sorting**:
```vue
<CroutonRepeater
  v-model="state.items"
  component-name="ItemInput"
  :sortable="false"
/>
```

### Component Name Resolution

CroutonRepeater dynamically resolves the item component by name:

```typescript
// Resolution process:
// 1. Uses resolveComponent() from Vue
// 2. Looks for component in components/ directory
// 3. Warns if component not found

// Example: component-name="ContactPerson"
// Resolves to: components/ContactPerson.vue
```

**Naming Requirements**:
- Must be PascalCase: `ContactPerson` not `contact-person`
- Must be in `components/` directory
- Component must be auto-registered by Nuxt

### Complete Example with Generated Form

```vue
<!-- Automatically generated by crouton generator -->
<script setup lang="ts">
import { z } from 'zod'

const props = defineProps<{
  action: 'create' | 'update'
  loading: string
  activeItem?: any
}>()

const state = ref({
  id: props.activeItem?.id || null,
  name: props.activeItem?.name || '',
  contacts: props.activeItem?.contacts || []
})

const schema = z.object({
  name: z.string().min(1),
  contacts: z.array(z.any()).optional()
})

const handleSubmit = async () => {
  // state.contacts is an array of objects:
  // [
  //   { id: 'abc123', name: 'John', email: 'john@example.com' },
  //   { id: 'def456', name: 'Jane', email: 'jane@example.com' }
  // ]
}
</script>

<template>
  <UForm :state="state" :schema="schema" @submit="handleSubmit">
    <UFormField label="Name" name="name">
      <UInput v-model="state.name" />
    </UFormField>

    <UFormField label="Contacts" name="contacts">
      <CroutonRepeater
        v-model="state.contacts"
        component-name="ContactPersonInput"
        add-label="Add Contact"
        :sortable="true"
      />
    </UFormField>

    <UButton type="submit">Save</UButton>
  </UForm>
</template>
```

```vue
<!-- components/ContactPersonInput.vue -->
<script setup lang="ts">
import { nanoid } from 'nanoid'

interface ContactPerson {
  id: string
  name: string
  email: string
  phone?: string
}

const model = defineModel<ContactPerson>()

// Ensure defaults
if (!model.value) {
  model.value = {
    id: nanoid(),
    name: '',
    email: '',
    phone: ''
  }
}
</script>

<template>
  <div class="grid grid-cols-3 gap-4">
    <UFormField label="Name" name="name">
      <UInput v-model="model.name" placeholder="Full name" />
    </UFormField>

    <UFormField label="Email" name="email">
      <UInput v-model="model.email" type="email" placeholder="email@example.com" />
    </UFormField>

    <UFormField label="Phone" name="phone">
      <UInput v-model="model.phone" type="tel" placeholder="(555) 123-4567" />
    </UFormField>
  </div>
</template>
```

### Performance Considerations

For large arrays (100+ items), consider these optimizations:

```vue
<!-- ⚠️ Deep watch can be expensive for large arrays -->
<CroutonRepeater
  v-model="state.largeArray"
  component-name="ItemInput"
/>
```

**Recommendations**:
1. **Limit items**: Use pagination or virtualization for >50 items
2. **Disable sorting**: Set `:sortable="false"` for very large lists
3. **Optimize child components**: Avoid heavy computations in item components
4. **Use production builds**: Dev mode is slower due to reactivity tracking

### Troubleshooting

#### Component not found error

```
[Vue warn]: Failed to resolve component: ContactPerson
```

**Solutions**:
1. **Check component name**: Must match exactly (PascalCase)
2. **Check file location**: Must be in `components/` directory
3. **Check file name**: `ContactPerson.vue` not `contact-person.vue`
4. **Restart dev server**: Nuxt may not have detected the new component

#### Items not updating

**Problem**: Changes to items don't reflect in the UI

**Solutions**:
1. **Check v-model**: Child component must use `defineModel()` or emit `update:modelValue`
2. **Check reactivity**: Ensure you're mutating the array correctly
3. **Avoid direct assignment**: Use reactive methods like `push()`, `splice()`

#### Drag-and-drop not working

**Problem**: Can't reorder items

**Solutions**:
1. **Check `sortable` prop**: Must be `true` (default)
2. **Check item key**: Each item needs unique `id`
3. **Check browser support**: Some browsers may not support drag-and-drop
4. **Check CSS conflicts**: Z-index or overflow issues

#### Empty state not showing

**Problem**: No message when array is empty

**Solutions**:
1. **Initialize as empty array**: `contacts: []` not `contacts: null`
2. **Check UCard rendering**: Empty state is inside a UCard
3. **Check styling**: May be hidden by CSS

#### Delete removes wrong item

**Problem**: Clicking × removes different item than expected

**Solutions**:
1. **Check unique IDs**: Each item must have unique `id` field
2. **Use `nanoid()`**: Generates collision-resistant IDs
3. **Don't use array index**: Index changes when items are reordered

### When Not to Use Repeater

**Use Reference Fields Instead When**:
- Items need their own database table
- Items are shared across multiple parent records
- Items need complex querying or filtering
- Items have their own lifecycle (created/updated independently)
- You need referential integrity

**Example**: Don't use repeater for "tags" - use a proper tags table with references.

---


---

## CroutonFormActionButton

A styled submit button for form actions that shows loading states and validation warnings.

### Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `action` | `string` | *required* | Action type (e.g., 'create', 'update', 'delete') |
| `collection` | `string` | *required* | Collection name for button label |
| `items` | `Array` | `[]` | Items being acted upon |
| `loading` | `string` | `''` | Loading state identifier |
| `hasValidationErrors` | `boolean` | `false` | Whether form has validation errors |

### Features

- **Action-Based Styling**: Different colors and labels based on action type
- **Loading States**: Shows loading spinner when `loading !== 'notLoading'`
- **Validation Warning**: Shows alert icon and outline variant when errors exist
- **Auto-Labeling**: Generates button text from action and collection name
- **Delete Confirmation**: Uses error color for destructive actions

### Usage

#### Basic Usage

```vue
<template>
  <CroutonForm
    collection="products"
    action="create"
    v-slot="{ loading, hasValidationErrors }"
  >
    <!-- Form fields -->
    
    <CroutonFormActionButton
      action="create"
      collection="products"
      :loading="loading"
      :has-validation-errors="hasValidationErrors"
    />
  </CroutonForm>
</template>
```

#### Different Actions

```vue
<!-- Create action (primary color) -->
<CroutonFormActionButton
  action="create"
  collection="products"
  :loading="loading"
/>
<!-- Button text: "Create Product" -->

<!-- Update action (primary color) -->
<CroutonFormActionButton
  action="update"
  collection="products"
  :loading="loading"
/>
<!-- Button text: "Update Product" -->

<!-- Delete action (error color) -->
<CroutonFormActionButton
  action="delete"
  collection="products"
  :loading="loading"
/>
<!-- Button text: "Delete Product" -->
```

### Visual States

| State | Appearance |
|-------|------------|
| Normal | Solid button with action color |
| Loading | Disabled with spinner |
| Has Errors | Outline variant with warning icon |
| Delete Action | Error color (red) |

::callout{icon="i-lucide-triangle-alert" color="amber"}
**Validation Behavior**: When `hasValidationErrors` is true, the button shows an alert icon and uses outline variant, but remains clickable to allow form validation feedback.
::

---


---

## CroutonFormDependentButtonGroup

A button group component that renders selectable cards for dependent field options. Used within forms to select from options stored in a related item.

### Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `modelValue` | `string[] \| null` | `null` | Selected option ID(s) |
| `options` | `Option[]` | `[]` | Available options to select from |
| `multiple` | `boolean` | `false` | Allow multiple selections |
| `dependentCollection` | `string` | *required* | Collection name for card resolution |
| `dependentField` | `string` | *required* | Field name for card resolution |
| `cardVariant` | `string` | `'Mini'` | Card component variant suffix |

### Features

- **Single/Multiple Selection**: Supports both single and multi-select modes
- **Visual Selection State**: Selected items show a primary ring
- **Custom Card Components**: Dynamically resolves custom card components
- **Fallback Rendering**: Uses badges if no custom component exists
- **Keyboard Accessible**: Clickable cards with proper focus states

### Usage

#### Single Selection

```vue
<template>
  <CroutonFormDependentButtonGroup
    v-model="selectedSlot"
    :options="availableSlots"
    dependent-collection="locations"
    dependent-field="slots"
  />
</template>

<script setup lang="ts">
const selectedSlot = ref<string[] | null>(null)

const availableSlots = [
  { id: 'slot-1', label: 'Morning', time: '9:00 AM' },
  { id: 'slot-2', label: 'Afternoon', time: '2:00 PM' },
  { id: 'slot-3', label: 'Evening', time: '7:00 PM' }
]
</script>
```

#### Multiple Selection

```vue
<template>
  <CroutonFormDependentButtonGroup
    v-model="selectedFeatures"
    :options="availableFeatures"
    :multiple="true"
    dependent-collection="products"
    dependent-field="features"
  />
</template>

<script setup lang="ts">
const selectedFeatures = ref<string[] | null>(null)
</script>
```

### Custom Card Component

Create a custom card component for rich option display:

```vue
<!-- components/LocationsSlotCardMini.vue -->
<template>
  <div class="p-4 border rounded-lg hover:border-primary transition">
    <div class="flex items-center gap-3">
      <UIcon :name="value.icon" class="w-6 h-6" />
      <div>
        <p class="font-semibold">{{ value.label }}</p>
        <p class="text-sm text-gray-500">{{ value.time }}</p>
      </div>
    </div>
    <UBadge
      v-if="value.available"
      color="success"
      variant="soft"
      size="sm"
      class="mt-2"
    >
      Available
    </UBadge>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  value: {
    id: string
    label: string
    time: string
    icon: string
    available: boolean
  }
}>()
</script>
```

### Selection Behavior

#### Single Selection Mode (`multiple: false`)
- Click an option: Selects it (stores as `[id]` array)
- Click selected option: Deselects it (sets to `null`)
- Click different option: Replaces current selection

#### Multiple Selection Mode (`multiple: true`)
- Click an option: Adds to selection
- Click selected option: Removes from selection
- Model value is always `string[]` or `null`

### Visual Feedback

```typescript
// Selected state
'ring-2 ring-primary-500 rounded-lg'

// Unselected state
'opacity-70 hover:opacity-100'
```

---


---

## CroutonFormDependentFieldLoader

A loader component that fetches options from a parent item's field and delegates rendering to the appropriate component. This is the main entry point for dependent field handling in forms.

### Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `modelValue` | `string[] \| null` | `null` | Selected option ID(s) |
| `dependentValue` | `string \| null` | `null` | Parent item ID to fetch |
| `dependentCollection` | `string` | *required* | Parent collection name |
| `dependentField` | `string` | *required* | Field in parent containing options |
| `dependentLabel` | `string` | `'Selection'` | Label for empty state message |
| `multiple` | `boolean` | `false` | Allow multiple selections |
| `cardVariant` | `string` | `'Mini'` | Card component variant |
| `idKey` | `string` | `'id'` | Key for option IDs |
| `labelKey` | `string` | `'label'` | Key for option labels |
| `valueKey` | `string` | `'value'` | Key for option values |

### Features

- **Automatic Data Fetching**: Fetches parent item using `useCollectionItem`
- **Custom Component Resolution**: Looks for custom selection components
- **Smart Fallbacks**: Falls back to `CroutonFormDependentButtonGroup` if no custom component
- **Loading & Error States**: Built-in pending and error handling
- **Auto-Reset**: Clears selection when dependent value changes
- **Validation**: Clears invalid selections when options change

### Usage

#### In a Form

```vue
<template>
  <CroutonForm collection="bookings" action="create">
    <UFormField label="Location" name="locationId">
      <CroutonFormReferenceSelect
        v-model="formData.locationId"
        collection="locations"
      />
    </UFormField>

    <UFormField label="Time Slot" name="slotId">
      <CroutonFormDependentFieldLoader
        v-model="formData.slotId"
        :dependent-value="formData.locationId"
        dependent-collection="locations"
        dependent-field="slots"
        dependent-label="Location"
      />
    </UFormField>
  </CroutonForm>
</template>
```

### States

The component handles several states automatically:

| State | Display |
|-------|---------|
| Loading | "Loading options..." with spinner |
| Error | "Failed to load options" in warning color |
| No Parent Selected | "{dependentLabel} required" message |
| No Options | "No options available" message |
| Success | Renders selection component with options |

### Dependent Value Watching

The component watches for changes to `dependentValue` and automatically:
1. Clears current selection when parent changes
2. Re-fetches options from new parent
3. Validates selection against new options

```typescript
// Example: User changes location
formData.locationId = 'loc-2'

// Component automatically:
// 1. Clears formData.slotId
// 2. Fetches new slots from 'loc-2'
// 3. Updates available options
```

### Custom Component Registration

Register custom selection components using the `dependentFieldComponentMap`:

```typescript
// In your layer's `useCollections.ts`
export const dependentFieldComponentMap = {
  'locations': {
    'slots': 'LocationsSlotsSelector'  // Custom component
  },
  'events': {
    'categories': 'EventsCategoriesSelector'
  }
}
```

If no custom component is registered, falls back to `CroutonFormDependentButtonGroup`.

---


---

## CroutonFormDependentSelectOption

An intermediate component that wraps `CroutonFormDependentButtonGroup` and handles loading/error states for dependent field options.

::callout{icon="i-lucide-info" color="blue"}
**Note**: This component is typically used internally by `CroutonFormDependentFieldLoader`. You rarely need to use it directly.
::

### Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `modelValue` | `string[] \| null` | `null` | Selected option ID(s) |
| `options` | `Option[]` | `[]` | Available options |
| `pending` | `boolean` | `false` | Loading state |
| `error` | `any` | `null` | Error object |
| `dependentValue` | `string \| null` | `null` | Parent item ID |
| `dependentLabel` | `string` | `'Selection'` | Label for empty state |
| `multiple` | `boolean` | `false` | Allow multiple selections |
| `dependentCollection` | `string` | *required* | Collection name |
| `dependentField` | `string` | *required* | Field name |
| `cardVariant` | `string` | `'Mini'` | Card variant |

### Usage

```vue
<template>
  <CroutonFormDependentSelectOption
    v-model="selectedOptions"
    :options="fetchedOptions"
    :pending="isLoading"
    :error="fetchError"
    :dependent-value="parentId"
    dependent-label="Parent Item"
    dependent-collection="items"
    dependent-field="options"
  />
</template>
```

### State Handling

The component renders different UI based on the current state:

```vue
<!-- Loading -->
<div v-if="pending">
  <UIcon name="i-lucide-refresh-cw" class="animate-spin" />
  Loading options...
</div>

<!-- Error -->
<div v-else-if="error" class="text-warning">
  Failed to load options
</div>

<!-- No parent selected -->
<div v-else-if="!dependentValue" class="text-neutral">
  {{ dependentLabel }} required
</div>

<!-- No options available -->
<div v-else-if="!options || options.length === 0" class="text-neutral">
  No options available
</div>

<!-- Success: render button group -->
<CroutonFormDependentButtonGroup
  v-else
  v-model="localValue"
  :options="options"
  :multiple="multiple"
  :dependent-collection="dependentCollection"
  :dependent-field="dependentField"
  :card-variant="cardVariant"
/>
```

---


---

## CroutonCalendar

A flexible calendar component that supports both single date and date range selection with native Date/timestamp support.

### Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `date` | `Date \| number \| null` | `null` | Date or timestamp for single date mode |
| `range` | `boolean` | `false` | Enable range selection mode |
| `startDate` | `Date \| number \| null` | `null` | Start date or timestamp for range mode |
| `endDate` | `Date \| number \| null` | `null` | End date or timestamp for range mode |
| `color` | `'primary' \| 'secondary' \| 'success' \| 'info' \| 'warning' \| 'error' \| 'neutral'` | `'primary'` | Calendar accent color |
| `variant` | `'solid' \| 'outline' \| 'soft' \| 'subtle'` | `'solid'` | Visual style variant |
| `size` | `'xs' \| 'sm' \| 'md' \| 'lg' \| 'xl'` | `'md'` | Calendar size |
| `disabled` | `boolean` | `false` | Disable all interactions |
| `minDate` | `Date \| number \| null` | `null` | Minimum selectable date or timestamp |
| `maxDate` | `Date \| number \| null` | `null` | Maximum selectable date or timestamp |
| `monthControls` | `boolean` | `true` | Show month navigation controls |
| `yearControls` | `boolean` | `true` | Show year navigation controls |
| `numberOfMonths` | `number` | `undefined` | Number of months to display (default: 1 for single, 2 for range) |

### Events

| Event | Payload | Description |
|-------|---------|-------------|
| `update:date` | `Date \| null` | Emitted when single date changes |
| `update:startDate` | `Date \| null` | Emitted when range start date changes |
| `update:endDate` | `Date \| null` | Emitted when range end date changes |

### Features

- **Dual Mode**: Single date or range selection
- **Flexible Input**: Accepts Date objects or timestamps
- **Date Constraints**: Min/max date restrictions
- **Timezone Aware**: Uses local timezone for conversions
- **Auto Months**: Automatically shows 1 month for single, 2 for range
- **UCalendar Wrapper**: Built on Nuxt UI 4 calendar component

### Usage

#### Single Date Selection

```vue
<template>
  <CroutonCalendar
    v-model:date="selectedDate"
    :min-date="minDate"
    :max-date="maxDate"
    color="primary"
  />
</template>

<script setup lang="ts">
const selectedDate = ref<Date | null>(new Date())
const minDate = new Date('2024-01-01')
const maxDate = new Date('2024-12-31')
</script>
```

#### Date Range Selection

```vue
<template>
  <CroutonCalendar
    v-model:start-date="startDate"
    v-model:end-date="endDate"
    range
    :number-of-months="2"
    color="primary"
  />
</template>

<script setup lang="ts">
const startDate = ref<Date | null>(null)
const endDate = ref<Date | null>(null)

watch([startDate, endDate], ([start, end]) => {
  if (start && end) {
    console.log('Range selected:', { start, end })
  }
})
</script>
```

#### With Timestamp Support

```vue
<template>
  <CroutonCalendar
    v-model:date="timestamp"
    :min-date="minTimestamp"
  />
</template>

<script setup lang="ts">
// Works with timestamps directly
const timestamp = ref<number>(Date.now())
const minTimestamp = Date.now() - (30 * 24 * 60 * 60 * 1000) // 30 days ago
</script>
```

#### Constrained Range Selection

```vue
<template>
  <CroutonCalendar
    v-model:start-date="checkIn"
    v-model:end-date="checkOut"
    range
    :min-date="today"
    :max-date="maxBookingDate"
    :number-of-months="3"
    color="success"
    variant="soft"
  />
</template>

<script setup lang="ts">
const checkIn = ref<Date | null>(null)
const checkOut = ref<Date | null>(null)
const today = new Date()
const maxBookingDate = new Date()
maxBookingDate.setFullYear(today.getFullYear() + 1)
</script>
```

#### Custom Styling and Size

```vue
<template>
  <CroutonCalendar
    v-model:date="eventDate"
    color="secondary"
    variant="outline"
    size="lg"
    :month-controls="false"
    :year-controls="true"
  />
</template>

<script setup lang="ts">
const eventDate = ref<Date | null>(null)
</script>
```

### Date Conversion

The component automatically handles conversion between native Date/timestamp and Nuxt UI's CalendarDate format:

```typescript
// Input: Date or number (timestamp)
const myDate = new Date('2024-03-15') // or Date.now()

// Component converts to @internationalized/date format internally
// Output: Date object emitted via events
```

::callout{icon="i-lucide-info" color="blue"}
**Timezone Handling**: The component uses `getLocalTimeZone()` for all conversions, ensuring dates are interpreted in the user's local timezone.
::

---

## CroutonFormDynamicLoader

Dynamically loads collection-specific form/detail components based on collection name and action.

### Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `collection` | `string` | - | Collection name to load component for |
| `loading` | `string` | - | Loading state indicator |
| `action` | `string` | - | Action type ('view', 'create', 'update', 'delete') |
| `items` | `Array` | `[]` | Array of items to pass to component |
| `activeItem` | `Object` | `{}` | Currently active item object |

### Features

- **Dynamic Component Resolution**: Automatically resolves components from `useCollections().componentMap`
- **Convention-Based Detail Views**: Replaces 'Form' with 'Detail' suffix for view actions
- **Fallback Mechanism**: Falls back to Form component if Detail doesn't exist
- **Special Mode Handling**: Supports system/team modes for translationsUi collection
- **Attribute Passthrough**: Forwards all attrs to dynamic component

### Usage

#### Basic Dynamic Loading

```vue
<template>
  <CroutonFormDynamicLoader
    :collection="currentCollection"
    :action="currentAction"
    :items="items"
    :active-item="selectedItem"
    :loading="loadingState"
  />
</template>

<script setup lang="ts">
const currentCollection = ref('users')
const currentAction = ref('update')
const selectedItem = ref({ id: '123', name: 'John' })
const items = ref([])
const loadingState = ref('')
</script>
```

#### With View/Detail Convention

```vue
<template>
  <!-- When action='view', tries to load UserDetail component -->
  <!-- Falls back to UserForm if UserDetail doesn't exist -->
  <CroutonFormDynamicLoader
    collection="users"
    action="view"
    :active-item="user"
  />
</template>
```

#### Collection Component Map Setup

```typescript
// In useCollections composable
export const useCollections = () => {
  const componentMap = {
    'users': 'UserForm',
    'products': 'ProductForm',
    'orders': 'OrderForm'
    // For action='view', loader will try:
    // - UserDetail (if exists)
    // - UserForm (fallback)
  }
  
  return { componentMap }
}
```

#### TranslationsUi Mode Support

```vue
<template>
  <!-- Automatically detects system vs team mode from route -->
  <CroutonFormDynamicLoader
    collection="translationsUi"
    action="update"
    :active-item="translation"
  />
</template>

<script setup lang="ts">
// Route: /super-admin/translations → mode: 'system'
// Route: /team/translations → mode: 'team'
// Mode is automatically passed to the loaded component
</script>
```

### Component Not Found Handling

```vue
<template>
  <CroutonFormDynamicLoader
    collection="unknownCollection"
    action="create"
  />
  <!-- Shows: "Component not found for collection: unknownCollection" -->
</template>
```

::callout{icon="i-lucide-triangle-alert" color="amber"}
**Component Registration**: Ensure all components referenced in `componentMap` are properly registered and auto-imported.
::

---


---

## CroutonFormLayout

A responsive form layout with optional tabs, sidebar, and error indicators.

### Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `tabs` | `boolean` | `false` | Enable tab navigation |
| `navigationItems` | `NavigationItem[]` | `[]` | Array of navigation/tab items |
| `tabErrors` | `Record<string, number>` | `{}` | Error counts per tab (key: tab value, value: error count) |
| `modelValue` | `string` | `''` | Active section/tab value (v-model) |

### Types

```typescript
interface NavigationItem {
  label: string
  value: string
  icon?: string
}
```

### Events

| Event | Payload | Description |
|-------|---------|-------------|
| `update:modelValue` | `string` | Emitted when active section changes |

### Slots

| Slot | Props | Description |
|------|-------|-------------|
| `header` | - | Header content above main area |
| `main` | `{ activeSection: string }` | Main content area |
| `sidebar` | - | Sidebar content (desktop column, mobile accordion) |
| `footer` | - | Footer content below main area |

### Features

- **Responsive Grid**: 1 column mobile, 3 columns desktop when sidebar exists
- **Tab Navigation**: Optional UTabs with error badges
- **Error Indicators**: Red badges on tabs with validation errors
- **Mobile Accordion**: Sidebar converts to accordion on mobile
- **Container Queries**: Uses @container for responsive breakpoints
- **Auto-Detection**: Detects sidebar slot usage automatically

### Usage

#### Basic Layout with Tabs

```vue
<template>
  <CroutonFormLayout
    v-model="activeSection"
    tabs
    :navigation-items="sections"
    :tab-errors="validationErrors"
  >
    <template #header>
      <h1>Edit Profile</h1>
    </template>

    <template #main="{ activeSection }">
      <div v-show="activeSection === 'general'">
        <!-- General fields -->
      </div>
      <div v-show="activeSection === 'security'">
        <!-- Security fields -->
      </div>
    </template>

    <template #footer>
      <div class="flex justify-end gap-2">
        <UButton variant="outline">Cancel</UButton>
        <UButton color="primary">Save</UButton>
      </div>
    </template>
  </CroutonFormLayout>
</template>

<script setup lang="ts">
const activeSection = ref('general')

const sections = [
  { label: 'General', value: 'general', icon: 'i-lucide-user' },
  { label: 'Security', value: 'security', icon: 'i-lucide-lock' }
]

const validationErrors = ref({
  'general': 2, // 2 errors in general tab
  'security': 0
})
</script>
```

#### With Sidebar

```vue
<template>
  <CroutonFormLayout
    v-model="activeTab"
    tabs
    :navigation-items="tabs"
  >
    <template #main="{ activeSection }">
      <!-- Main form content -->
      <UFormGroup label="Title">
        <UInput v-model="title" />
      </UFormGroup>
    </template>

    <template #sidebar>
      <!-- Sidebar metadata (desktop: right column, mobile: accordion) -->
      <UCard>
        <h3 class="text-sm font-semibold mb-2">Metadata</h3>
        <UFormGroup label="Status">
          <USelect v-model="status" :items="statusOptions" />
        </UFormGroup>
        <UFormGroup label="Category">
          <USelect v-model="category" :items="categories" />
        </UFormGroup>
      </UCard>
    </template>

    <template #footer>
      <UButton color="primary" @click="save">Publish</UButton>
    </template>
  </CroutonFormLayout>
</template>

<script setup lang="ts">
const activeTab = ref('content')
const tabs = [
  { label: 'Content', value: 'content' },
  { label: 'SEO', value: 'seo' }
]

const title = ref('')
const status = ref('draft')
const category = ref('')
</script>
```

#### Error Badge Visualization

```vue
<template>
  <CroutonFormLayout
    v-model="section"
    tabs
    :navigation-items="formSections"
    :tab-errors="errorsBySection"
  >
    <!-- Tabs with errors show red dot badges -->
  </CroutonFormLayout>
</template>

<script setup lang="ts">
const formSections = [
  { label: 'Profile', value: 'profile' },
  { label: 'Address', value: 'address' },
  { label: 'Payment', value: 'payment' }
]

// Tabs with >0 errors show red badge with "●"
const errorsBySection = ref({
  'profile': 0,
  'address': 3, // Shows red dot on Address tab
  'payment': 1  // Shows red dot on Payment tab
})
</script>
```

#### Simple Form (No Tabs or Sidebar)

```vue
<template>
  <CroutonFormLayout>
    <template #header>
      <h2>Create Account</h2>
    </template>

    <template #main>
      <div class="space-y-4">
        <UFormGroup label="Email">
          <UInput v-model="email" type="email" />
        </UFormGroup>
        <UFormGroup label="Password">
          <UInput v-model="password" type="password" />
        </UFormGroup>
      </div>
    </template>

    <template #footer>
      <UButton color="primary" block>Sign Up</UButton>
    </template>
  </CroutonFormLayout>
</template>
```

### Responsive Behavior

| Screen Size | Main Area | Sidebar |
|-------------|-----------|---------|
| Mobile (< @lg) | Full width | Accordion above main |
| Desktop (@lg+) | 2/3 width | 1/3 right column |

::callout{icon="i-lucide-info" color="blue"}
**Container Queries**: Uses `@container` instead of traditional media queries for more flexible responsive behavior within any parent.
::

---


---

## CroutonFormReferenceSelect

A select menu for referencing items from another collection with create-on-the-fly support.

### Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `modelValue` | `string \| string[] \| null` | - | Selected item ID(s) |
| `collection` | `string` | - | Collection to fetch items from |
| `label` | `string` | - | Display label for the select |
| `labelKey` | `string` | `'title'` | Object key to use as display label |
| `filterFields` | `string[]` | `['title', 'name']` | Fields to search when filtering |
| `hideCreate` | `boolean` | `false` | Hide the "Create new" button |
| `multiple` | `boolean` | `false` | Enable multiple selection |

### Events

| Event | Payload | Description |
|-------|---------|-------------|
| `update:modelValue` | `string \| string[] \| null` | Emitted when selection changes |

### Features

- **Auto-Create**: Create new items directly from the dropdown
- **Searchable**: Built-in search across filter fields
- **Multiple Selection**: Support for selecting multiple items
- **Error Handling**: User-friendly error messages (404, 403, 500)
- **Auto-Select**: Automatically selects newly created items
- **Loading States**: Shows loading indicator while fetching
- **Null Handling**: Returns null when selection is cleared

### Usage

#### Basic Reference Select

```vue
<template>
  <UFormGroup label="Author">
    <CroutonFormReferenceSelect
      v-model="authorId"
      collection="users"
      label="author"
      label-key="name"
      :filter-fields="['name', 'email']"
    />
  </UFormGroup>
</template>

<script setup lang="ts">
const authorId = ref<string | null>(null)

watch(authorId, (newId) => {
  console.log('Selected author:', newId)
})
</script>
```

#### Multiple Selection

```vue
<template>
  <UFormGroup label="Tags">
    <CroutonFormReferenceSelect
      v-model="tagIds"
      collection="tags"
      label="tags"
      label-key="name"
      multiple
    />
  </UFormGroup>
</template>

<script setup lang="ts">
const tagIds = ref<string[]>([])

watch(tagIds, (newIds) => {
  console.log('Selected tags:', newIds)
})
</script>
```

#### With Create Disabled

```vue
<template>
  <CroutonFormReferenceSelect
    v-model="categoryId"
    collection="categories"
    label="category"
    hide-create
  />
</template>

<script setup lang="ts">
const categoryId = ref<string | null>(null)
</script>
```

#### Auto-Create Workflow

```vue
<template>
  <CroutonFormReferenceSelect
    v-model="projectId"
    collection="projects"
    label="project"
  />
  <!-- User clicks "Create new project" → Modal opens
       User saves new project → Item auto-selected -->
</template>

<script setup lang="ts">
const projectId = ref<string | null>(null)

// After creating a new project, projectId automatically updates
watch(projectId, (id) => {
  if (id) {
    console.log('Project selected or created:', id)
  }
})
</script>
```

#### Custom Filter Fields

```vue
<template>
  <CroutonFormReferenceSelect
    v-model="productId"
    collection="products"
    label="product"
    label-key="title"
    :filter-fields="['title', 'sku', 'description']"
  />
</template>

<script setup lang="ts">
const productId = ref<string | null>(null)
// Search will match against title, SKU, or description
</script>
```

### Error States

The component displays user-friendly error messages:

| Status Code | Error Message |
|-------------|---------------|
| 404 | "The data endpoint could not be found. Please check your team settings or contact support." |
| 403 | "You do not have permission to view this data." |
| 500+ | "A server error occurred. Please try again later." |
| Other | Displays `statusMessage` or generic error |

```vue
<template>
  <!-- If collection endpoint returns 404 -->
  <CroutonFormReferenceSelect
    v-model="itemId"
    collection="missing-collection"
  />
  <!-- Shows red alert with error message above select -->
</template>
```

### Label Key Fallback

If the specified `labelKey` isn't found, the component falls back through:
1. `labelKey` prop value
2. `title` field
3. `name` field
4. `id` field

```typescript
// Display order: option[labelKey] || option.title || option.name || option.id
```

::callout{icon="i-lucide-triangle-alert" color="amber"}
**Collection Query**: Ensure the collection endpoint is available at `/api/collections/{collection}` and returns an array of items with `id` fields.
::

---


---

## CroutonFormRepeater

A repeater component for managing dynamic lists of sub-forms with drag-to-reorder support.

### Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `modelValue` | `any[] \| null` | - | Array of repeater items |
| `componentName` | `string` | - | Name of component to render for each item |
| `addLabel` | `string` | `'Add Item'` | Label for add button |
| `sortable` | `boolean` | `true` | Enable drag-to-reorder |

### Events

| Event | Payload | Description |
|-------|---------|-------------|
| `update:modelValue` | `any[]` | Emitted when items array changes |

### Features

- **Drag-to-Reorder**: Uses VueUse `useSortable` for drag-drop reordering
- **Unique IDs**: Auto-generates nanoid for new items
- **Empty State**: Shows helpful empty state when no items
- **Item Removal**: Delete button for each item
- **Animation**: 200ms animation on reorder
- **Component Resolution**: Automatically resolves registered components
- **Debug Logging**: Console logs for add/remove/update operations

### Usage

#### Basic Repeater

```vue
<template>
  <UFormGroup label="Contact Methods">
    <CroutonFormRepeater
      v-model="contacts"
      component-name="ContactMethodInput"
      add-label="Add Contact Method"
    />
  </UFormGroup>
</template>

<script setup lang="ts">
const contacts = ref([
  { id: '1', type: 'email', value: 'john@example.com' },
  { id: '2', type: 'phone', value: '+1234567890' }
])
</script>

<!-- ContactMethodInput.vue -->
<template>
  <div class="flex gap-2">
    <USelect v-model="localValue.type" :items="types" />
    <UInput v-model="localValue.value" />
  </div>
</template>

<script setup lang="ts">
const props = defineProps<{ modelValue: any }>()
const emit = defineEmits<{ 'update:modelValue': [value: any] }>()

const localValue = computed({
  get: () => props.modelValue,
  set: (val) => emit('update:modelValue', val)
})

const types = ['email', 'phone', 'address']
</script>
```

#### With Sortable Disabled

```vue
<template>
  <CroutonFormRepeater
    v-model="items"
    component-name="SimpleInput"
    add-label="Add Item"
    :sortable="false"
  />
</template>

<script setup lang="ts">
const items = ref([])
// No drag handle shown when sortable=false
</script>
```

#### Complex Repeater Items

```vue
<template>
  <CroutonFormRepeater
    v-model="addresses"
    component-name="AddressForm"
    add-label="Add Address"
  />
</template>

<script setup lang="ts">
const addresses = ref([
  {
    id: '1',
    street: '123 Main St',
    city: 'New York',
    state: 'NY',
    zip: '10001'
  }
])
</script>

<!-- AddressForm.vue -->
<template>
  <div class="space-y-2">
    <UInput v-model="localValue.street" placeholder="Street" />
    <div class="grid grid-cols-3 gap-2">
      <UInput v-model="localValue.city" placeholder="City" />
      <UInput v-model="localValue.state" placeholder="State" />
      <UInput v-model="localValue.zip" placeholder="ZIP" />
    </div>
  </div>
</template>

<script setup lang="ts">
const props = defineProps<{ modelValue: any }>()
const emit = defineEmits<{ 'update:modelValue': [value: any] }>()

const localValue = computed({
  get: () => props.modelValue,
  set: (val) => emit('update:modelValue', val)
})
</script>
```

#### Empty State

```vue
<template>
  <CroutonFormRepeater
    v-model="emptyList"
    component-name="ItemForm"
    add-label="Add First Item"
  />
  <!-- Shows: "No items yet. Click 'Add First Item' to get started." -->
</template>

<script setup lang="ts">
const emptyList = ref([])
</script>
```

### Drag Handle

When `sortable: true`, each item card shows a drag handle button:
- Icon: `i-lucide-grip-vertical`
- Class: `drag-handle` (required for sortable)
- Cursor: `cursor-move`

### Item Card Structure

Each repeater item is wrapped in a UCard with:
- Drag handle (if sortable)
- Remove button (always shown)
- Component slot for item content

```vue
<!-- Internal structure -->
<UCard>
  <div class="flex gap-2 justify-between">
    <UButton v-if="sortable" class="drag-handle" />
    <UButton color="error" @click="removeItem" />
  </div>
  <component :is="componentName" v-model="item" />
</UCard>
```

### Component Requirements

The component specified in `componentName` must:
1. Accept `modelValue` prop
2. Emit `update:modelValue` event
3. Be globally registered or auto-imported

```vue
<!-- ✅ Correct -->
<script setup lang="ts">
defineProps<{ modelValue: any }>()
defineEmits<{ 'update:modelValue': [value: any] }>()
</script>

<!-- ❌ Wrong -->
<script setup lang="ts">
// Missing modelValue/emit - won't work with repeater
</script>
```

::callout{icon="i-lucide-info" color="blue"}
**Auto-Import**: Components must be registered globally or available via Nuxt auto-imports. Check console for warnings if component resolution fails.
::

---


---

## Related Resources

- [Form Composables](/api-reference/composables/form-composables) - Form state management
- [Nuxt UI Form](https://ui.nuxt.com/components/form) - Base form component documentation
- [Validation Guide](/patterns/forms) - Form validation patterns
