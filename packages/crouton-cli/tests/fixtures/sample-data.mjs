/**
 * Sample test data for CLI generator tests
 *
 * These fixtures provide consistent test data for:
 * - Field definitions
 * - Generator data objects
 * - Config objects
 */

// ============ Field Definitions ============

/**
 * Mirror of what loadFields attaches from the core manifest (#2286): every field
 * carries the form control its (canonical) type declares. Generators render
 * `field.component`; keeping the fixtures in the real shape is what lets the
 * form snapshots prove the manifest-driven path is byte-identical.
 */
const MANIFEST_COMPONENT = {
  string: 'UInput', text: 'UTextarea', number: 'UInputNumber', decimal: 'UInputNumber',
  boolean: 'UCheckbox', date: 'CroutonCalendar', json: 'UTextarea', repeater: 'CroutonFormRepeater',
  array: 'UTextarea', reference: 'CroutonFormReferenceSelect', image: 'CroutonImageUpload', file: 'CroutonImageUpload'
}
export const withComponent = (fields) => fields.map(f => ({ ...f, component: f.component ?? MANIFEST_COMPONENT[f.type] }))

/**
 * Basic field definitions for a simple collection
 */
export const basicFields = withComponent([
  { name: 'name', type: 'string', meta: { required: true, maxLength: 255 } },
  { name: 'description', type: 'text', meta: {} },
  { name: 'price', type: 'decimal', meta: { precision: 10, scale: 2 } },
  { name: 'active', type: 'boolean', meta: {} }
])

/**
 * Complex field definitions with all field types
 */
export const allTypesFields = withComponent([
  { name: 'title', type: 'string', meta: { required: true } },
  { name: 'content', type: 'text', meta: {} },
  { name: 'count', type: 'number', meta: {} },
  { name: 'price', type: 'decimal', meta: {} },
  { name: 'enabled', type: 'boolean', meta: {} },
  { name: 'publishedAt', type: 'date', meta: {} },
  { name: 'metadata', type: 'json', meta: {} },
  { name: 'items', type: 'repeater', meta: {} },
  { name: 'tags', type: 'array', meta: {} }
])

/**
 * Fields with references
 */
export const fieldsWithRefs = withComponent([
  { name: 'name', type: 'string', meta: { required: true } },
  { name: 'categoryId', type: 'string', refTarget: 'categories', meta: {} }
])

/**
 * Fields for seed generator testing
 */
export const seedTestFields = withComponent([
  { name: 'email', type: 'string' },
  { name: 'fullName', type: 'string' },
  { name: 'firstName', type: 'string' },
  { name: 'lastName', type: 'string' },
  { name: 'title', type: 'string' },
  { name: 'description', type: 'text' },
  { name: 'phone', type: 'string' },
  { name: 'website', type: 'string' },
  { name: 'price', type: 'decimal' },
  { name: 'quantity', type: 'number' },
  { name: 'address', type: 'string' },
  { name: 'city', type: 'string' },
  { name: 'status', type: 'string' },
  { name: 'unknownField', type: 'string' },
  { name: 'isActive', type: 'boolean' },
  { name: 'createdAt', type: 'date' },
  { name: 'settings', type: 'json' }
])

// ============ Generator Data Objects ============

/**
 * Minimal data object for generateTypes()
 */
export const basicTypesData = {
  singular: 'product',
  plural: 'products',
  pascalCase: 'Product',
  pascalCasePlural: 'Products',
  layer: 'shop',
  layerPascalCase: 'Shop',
  layerCamelCase: 'shop', // camelCase version for collection names
  fields: basicFields,
  fieldsTypes: `name: string
  description: string
  price: number
  active: boolean`
}

/**
 * Minimal data object for generateComposable()
 */
export const basicComposableData = {
  singular: 'product',
  plural: 'products',
  pascalCase: 'Product',
  pascalCasePlural: 'Products',
  layer: 'shop',
  layerPascalCase: 'Shop',
  layerCamelCase: 'shop', // camelCase version for collection names
  fields: basicFields,
  fieldsSchema: `name: z.string().max(255),
    description: z.string().optional(),
    price: z.number().optional(),
    active: z.boolean().optional()`,
  fieldsColumns: `{ key: 'name', label: 'Name' },
  { key: 'price', label: 'Price' },
  { key: 'active', label: 'Active' }`,
  fieldsDefault: `name: '',
    description: '',
    price: 0,
    active: false`,
  hierarchy: null,
  sortable: null
}

/**
 * Data object with hierarchy enabled
 */
export const hierarchyData = {
  ...basicComposableData,
  singular: 'category',
  plural: 'categories',
  pascalCase: 'Category',
  pascalCasePlural: 'Categories',
  hierarchy: {
    enabled: true,
    parentField: 'parentId',
    pathField: 'path',
    depthField: 'depth',
    orderField: 'order'
  }
}

/**
 * Data object with sortable enabled
 */
export const sortableData = {
  ...basicComposableData,
  singular: 'tag',
  plural: 'tags',
  pascalCase: 'Tag',
  pascalCasePlural: 'Tags',
  sortable: {
    enabled: true,
    orderField: 'order'
  }
}

/**
 * Data object with dependent fields (repeater)
 */
export const dependentFieldsData = {
  ...basicComposableData,
  fields: withComponent([
    { name: 'name', type: 'string', meta: { required: true } },
    { name: 'items', type: 'repeater', meta: { repeaterComponent: 'ItemEditor' } }
  ])
}

/**
 * Data object with display config
 */
export const displayConfigData = {
  ...basicComposableData,
  display: {
    title: 'name',
    image: 'photo',
    badge: 'active',
    description: 'description'
  },
  fields: withComponent([
    { name: 'name', type: 'string', meta: { required: true, label: 'Name', area: 'main' } },
    { name: 'description', type: 'text', meta: { label: 'Description', area: 'main' } },
    { name: 'photo', type: 'image', meta: { label: 'Photo', area: 'main' } },
    { name: 'price', type: 'decimal', meta: { label: 'Price', area: 'sidebar' } },
    { name: 'active', type: 'boolean', meta: { label: 'Active', area: 'sidebar', displayAs: 'badge' } }
  ])
}

// ============ Config Objects ============

/**
 * Minimal config object
 */
export const minimalConfig = {
  flags: {
    useMetadata: true
  }
}

/**
 * Config with translations
 */
export const translationsConfig = {
  flags: {
    useMetadata: true
  },
  translations: {
    collections: {
      products: ['name', 'description']
    }
  }
}

// ============ Form Component Test Data ============

/**
 * Data object for form component tests (basic)
 */
export const formComponentData = {
  singular: 'product',
  plural: 'products',
  camelCase: 'product',
  pascalCase: 'Product',
  pascalCasePlural: 'Products',
  layer: 'shop',
  layerPascalCase: 'Shop',
  layerCamelCase: 'shop',
  fields: basicFields,
  hierarchy: null,
  sortable: null
}

/**
 * Data object for form component tests with hierarchy enabled
 */
export const formWithHierarchyData = {
  ...formComponentData,
  singular: 'category',
  plural: 'categories',
  camelCase: 'category',
  pascalCase: 'Category',
  pascalCasePlural: 'Categories',
  hierarchy: {
    enabled: true,
    parentField: 'parentId',
    pathField: 'path',
    depthField: 'depth',
    orderField: 'order'
  }
}

/**
 * Data object for form component tests with reference fields
 */
export const formWithRefsData = {
  ...formComponentData,
  fields: fieldsWithRefs
}

/**
 * Fields with date type for form component tests
 */
export const fieldsWithDate = withComponent([
  { name: 'name', type: 'string', meta: { required: true } },
  { name: 'publishedAt', type: 'date', meta: {} },
  { name: 'expiresAt', type: 'date', meta: {} }
])

/**
 * Data object for form component tests with date fields
 */
export const formWithDateData = {
  ...formComponentData,
  fields: fieldsWithDate
}

// ============ API Endpoints Test Data ============

/**
 * Data object for API endpoint tests
 */
export const apiEndpointData = {
  singular: 'product',
  plural: 'products',
  camelCase: 'product',
  pascalCase: 'Product',
  pascalCasePlural: 'Products',
  layer: 'shop',
  layerPascalCase: 'Shop',
  layerCamelCase: 'shop',
  fields: basicFields,
  fieldsSchema: `name: z.string().min(1, 'name is required'),\n  description: z.string().optional(),\n  price: z.number().optional(),\n  active: z.boolean().optional()`,
  hierarchy: null,
  sortable: null
}

/**
 * Data object for API endpoint tests with hierarchy
 */
export const apiWithHierarchyData = {
  ...apiEndpointData,
  singular: 'category',
  plural: 'categories',
  camelCase: 'category',
  pascalCase: 'Category',
  pascalCasePlural: 'Categories',
  hierarchy: {
    enabled: true,
    parentField: 'parentId',
    pathField: 'path',
    depthField: 'depth',
    orderField: 'order'
  }
}

/**
 * Data object for API endpoint tests with sortable
 */
export const apiWithSortableData = {
  ...apiEndpointData,
  singular: 'tag',
  plural: 'tags',
  camelCase: 'tag',
  pascalCase: 'Tag',
  pascalCasePlural: 'Tags',
  sortable: {
    enabled: true,
    orderField: 'order'
  }
}

/**
 * Data object for API endpoint tests with date fields
 */
export const apiWithDateData = {
  ...apiEndpointData,
  fields: fieldsWithDate
}

// ============ Database Schema Test Data ============

/**
 * Data object for database schema tests
 */
export const schemaData = {
  singular: 'product',
  plural: 'products',
  layer: 'shop',
  layerPascalCase: 'Shop',
  pascalCasePlural: 'Products',
  originalCollectionName: 'products',
  fields: basicFields,
  hierarchy: null,
  sortable: null
}

/**
 * Data object for database schema tests with hierarchy
 */
export const schemaWithHierarchyData = {
  ...schemaData,
  singular: 'category',
  plural: 'categories',
  pascalCasePlural: 'Categories',
  originalCollectionName: 'categories',
  hierarchy: {
    enabled: true,
    parentField: 'parentId',
    pathField: 'path',
    depthField: 'depth',
    orderField: 'order'
  }
}

/**
 * Data object for database schema tests with all field types
 */
export const schemaWithAllTypesData = {
  ...schemaData,
  fields: allTypesFields
}

/**
 * Data object for database schema tests with sortable
 */
export const schemaWithSortableData = {
  ...schemaData,
  singular: 'tag',
  plural: 'tags',
  pascalCasePlural: 'Tags',
  originalCollectionName: 'tags',
  sortable: true
}

// ============ Seed Data Test Data ============

/**
 * Data object for seed file tests
 */
export const seedData = {
  singular: 'product',
  plural: 'products',
  layer: 'shop',
  layerPascalCase: 'Shop',
  layerCamelCase: 'shop',
  pascalCasePlural: 'Products',
  fields: seedTestFields,
  hierarchy: null
}

/**
 * Data object for seed file tests with hierarchy
 */
export const seedWithHierarchyData = {
  ...seedData,
  singular: 'category',
  plural: 'categories',
  pascalCasePlural: 'Categories',
  hierarchy: {
    enabled: true,
    parentField: 'parentId',
    pathField: 'path',
    depthField: 'depth',
    orderField: 'order'
  }
}

/**
 * Data object for seed file tests with foreign keys
 */
export const seedWithForeignKeyData = {
  ...seedData,
  fields: fieldsWithRefs
}
