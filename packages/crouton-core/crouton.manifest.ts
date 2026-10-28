import { defineCroutonManifest } from './shared/manifest'

export default defineCroutonManifest({
  id: 'crouton-core',
  name: 'Crouton Core',
  description: 'Base CRUD framework with collections, forms, tables, and team support',
  icon: 'i-lucide-database',
  version: '1.0.0',
  category: 'core',
  bundled: true,

  fieldTypes: {
    string:    { label: 'String',    icon: 'i-lucide-type',         description: 'Short text (VARCHAR 255)',         db: 'VARCHAR(255)',    drizzle: 'text',      zod: 'z.string()',            tsType: 'string',              defaultValue: "''", seed: { drizzleSeed: 'f.loremIpsum({ sentencesCount: 1 })', fixture: '`Sample ${name} ${i + 1}`' }, testSample: '\'sample\'',    component: 'UInput' },
    text:      { label: 'Text',      icon: 'i-lucide-file-text',    description: 'Long text content',                db: 'TEXT',            drizzle: 'text',      zod: 'z.string()',            tsType: 'string',              defaultValue: "''", seed: { drizzleSeed: 'f.loremIpsum({ sentencesCount: 3 })', fixture: '`Sample ${name} content for row ${i + 1}. Lorem ipsum dolor sit amet, consectetur adipiscing elit.`' }, testSample: '\'sample\'',    component: 'UTextarea' },
    number:    { label: 'Number',    icon: 'i-lucide-hash',         description: 'Integer value',                    db: 'INTEGER',         drizzle: 'integer',   zod: 'z.number()',            tsType: 'number',              defaultValue: '0', seed: { drizzleSeed: 'f.int({ minValue: 0, maxValue: 100 })', fixture: 'i + 1' }, testSample: '1',     component: 'UInputNumber', aliases: ['integer'] },
    decimal:   { label: 'Decimal',   icon: 'i-lucide-percent',      description: 'Decimal number (10,2)',            db: 'DECIMAL(10,2)',   drizzle: 'decimal',   zod: 'z.number()',            tsType: 'number',              defaultValue: '0', seed: { drizzleSeed: 'f.number({ minValue: 0, maxValue: 1000, precision: 100 })', fixture: 'i + 1' }, testSample: '1',     component: 'UInputNumber', meta: { precision: 10, scale: 2 } },
    boolean:   { label: 'Boolean',   icon: 'i-lucide-toggle-left',  description: 'True/false toggle',                db: 'BOOLEAN',         drizzle: 'boolean',   zod: 'z.boolean()',           tsType: 'boolean',             defaultValue: 'false', seed: { drizzleSeed: 'f.weightedRandom([{ value: true, weight: 0.5 }, { value: false, weight: 0.5 }])', fixture: 'i % 2 === 0' }, testSample: 'true', component: 'UCheckbox' },
    date:      { label: 'Date',      icon: 'i-lucide-calendar',     description: 'Date/timestamp',                   db: 'TIMESTAMP',       drizzle: 'timestamp', zod: 'z.date()',              tsType: 'Date | null',         defaultValue: 'null', seed: { drizzleSeed: 'f.date({ minDate: "2020-01-01", maxDate: "2025-12-31" })', fixture: 'Math.floor(now / 1000) - i * 86_400' }, testSample: '\'2024-01-01T00:00:00.000Z\'',  component: 'CroutonCalendar', aliases: ['datetime'] },
    json:      { label: 'JSON',      icon: 'i-lucide-braces',       description: 'JSON object',                      db: 'JSON',            drizzle: 'json',      zod: 'z.record(z.string(), z.any())',     tsType: 'Record<string, any>', defaultValue: '{}', seed: { drizzleSeed: 'f.valuesFromArray({ values: [{}] })', fixture: '{}' }, testSample: '{}',    component: 'UTextarea' },
    repeater:  { label: 'Repeater',  icon: 'i-lucide-layers',       description: 'Repeatable items array',           db: 'JSON',            drizzle: 'json',      zod: 'z.array(z.any())',      tsType: 'any[]',               defaultValue: '[]', seed: { drizzleSeed: 'f.valuesFromArray({ values: [[]] })', fixture: '[]' }, testSample: '[]',    component: 'CroutonFormRepeater' },
    array:     { label: 'Array',     icon: 'i-lucide-list',         description: 'String array',                     db: 'TEXT',            drizzle: 'text',      zod: 'z.array(z.string())',   tsType: 'string[]',            defaultValue: '[]', seed: { drizzleSeed: 'f.valuesFromArray({ values: [[]] })', fixture: '[\'sample\']' }, testSample: '[]',    component: 'UTextarea' },
    reference: { label: 'Reference', icon: 'i-lucide-link',         description: 'Reference to another collection',  db: 'VARCHAR(255)',    drizzle: 'text',      zod: 'z.string()',            tsType: 'string',              defaultValue: "''", seed: { drizzleSeed: 'f.valuesFromArray({ values: [\'placeholder-id\'] })', fixture: '\'\'' }, testSample: '\'sample\'',    component: 'CroutonFormReferenceSelect' },
    image:     { label: 'Image',     icon: 'i-lucide-image',        description: 'Image upload',                     db: 'VARCHAR(255)',    drizzle: 'text',      zod: 'z.string()',            tsType: 'string',              defaultValue: "''", seed: { drizzleSeed: 'f.valuesFromArray({ values: [""] })', fixture: '\'\'' }, testSample: '\'sample\'',    component: 'CroutonImageUpload' },
    file:      { label: 'File',      icon: 'i-lucide-paperclip',    description: 'File upload',                      db: 'VARCHAR(255)',    drizzle: 'text',      zod: 'z.string()',            tsType: 'string',              defaultValue: "''", seed: { drizzleSeed: 'f.valuesFromArray({ values: [""] })', fixture: '\'\'' }, testSample: '\'sample\'',    component: 'CroutonImageUpload' },
  },

  autoGeneratedFields: [
    'id', 'teamId', 'owner',
    'createdAt', 'updatedAt', 'createdBy', 'updatedBy',
  ],

  reservedFieldNames: [
    'id', 'teamId', 'owner',
    'createdAt', 'updatedAt', 'createdBy', 'updatedBy',
    'order', 'optimisticId', 'optimisticAction',
    'parentId', 'path', 'depth',
  ],

  reservedCollectionNames: [
    'api', 'server', 'app', 'pages', 'components',
    'composables', 'layouts', 'middleware', 'plugins',
    'assets', 'public', 'node_modules',
  ],

  provides: {
    composables: ['useCollections', 'useCollectionImport', 'useCroutonApps', 'useDisplayConfig'],
    components: [
      { name: 'CroutonCollection', description: 'Full CRUD table with multi-layout support', props: ['collection', 'layout', 'columns'] },
      { name: 'CroutonDetail', description: 'Generic detail view using display config', props: ['collection', 'item'] },
      { name: 'CroutonFormLayout', description: 'Form layout with slots', props: ['collection'] },
      { name: 'CroutonDefaultCard', description: 'Display-aware card', props: ['item', 'collection'] },
      { name: 'CroutonImageUpload', description: 'File picker with optional crop support', props: ['modelValue', 'crop'] },
    ],
  },
})
