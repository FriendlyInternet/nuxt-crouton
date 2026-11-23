---
title: Manual Drizzle Setup
description: Learn how to set up Drizzle relations for advanced querying and performance optimization
icon: i-lucide-settings
---

If you want [Drizzle](https://orm.drizzle.team) relations for performance, set them up manually. This is optional but recommended for apps with complex relational queries.

## Step 1: Add Foreign Key to Schema

Add the foreign key field to your JSON schema:

```json
// schemas/product-schema.json
{
  "name": { "type": "string" },
  "price": { "type": "number" },
  "categoryId": { "type": "string" }
}
```

## Step 2: Define Relations in Schema Files

Add relation definitions to your Drizzle schema:

```typescript
// layers/shop/server/database/schema.ts
import { sqliteTable, text, real } from 'drizzle-orm/sqlite-core'
import { relations } from 'drizzle-orm'

export const shopProducts = sqliteTable('shop_products', {
  id: text('id').primaryKey(),
  teamId: text('teamId').notNull(),
  categoryId: text('categoryId'),  // Foreign key
  name: text('name').notNull(),
  price: real('price')
})

export const shopCategories = sqliteTable('shop_categories', {
  id: text('id').primaryKey(),
  teamId: text('teamId').notNull(),
  name: text('name').notNull()
})

// Define relations
export const shopProductsRelations = relations(shopProducts, ({ one }) => ({
  category: one(shopCategories, {
    fields: [shopProducts.categoryId],
    references: [shopCategories.id]
  })
}))

export const shopCategoriesRelations = relations(shopCategories, ({ many }) => ({
  products: many(shopProducts)
}))
```

## Step 3: Create Query Helpers (Optional)

Create reusable query functions:

```typescript
// layers/shop/server/database/queries.ts
export async function getShopProductsWithCategories(teamId: string) {
  const db = useDB()

  return await db.query.shopProducts.findMany({
    where: eq(shopProducts.teamId, teamId),
    with: { category: true },
    orderBy: desc(shopProducts.createdAt)
  })
}

export async function getShopProductWithCategory(productId: string, teamId: string) {
  const db = useDB()

  return await db.query.shopProducts.findFirst({
    where: and(
      eq(shopProducts.id, productId),
      eq(shopProducts.teamId, teamId)
    ),
    with: { category: true }
  })
}
```

## Step 4: Use in API Routes

Use your query helpers in API endpoints:

```typescript
// server/api/teams/[team]/shop-products/index.get.ts
import { getShopProductsWithCategories } from '~/layers/shop/server/database/queries'

export default defineEventHandler(async (event) => {
  const teamId = getRouterParam(event, 'team')
  return await getShopProductsWithCategories(teamId)
})
```

## Step 5: Add TypeScript Types

Define types for your data structures:

```typescript
// layers/shop/types/products.ts
import type { shopProducts, shopCategories } from '../server/database/schema'

export type ShopProduct = typeof shopProducts.$inferSelect
export type ShopCategory = typeof shopCategories.$inferSelect

// With relations
export interface ShopProductWithCategory extends ShopProduct {
  category?: ShopCategory | null
}
```

## Common Relation Patterns

### belongsTo (many-to-one)

**Use case:** Many products belong to one category

```typescript
// Schema
export const shopProducts = sqliteTable('shop_products', {
  id: text('id').primaryKey(),
  categoryId: text('categoryId')  // Foreign key
})

// Drizzle relation
export const shopProductsRelations = relations(shopProducts, ({ one }) => ({
  category: one(shopCategories, {
    fields: [shopProducts.categoryId],
    references: [shopCategories.id]
  })
}))

// Query
const product = await db.query.shopProducts.findFirst({
  where: eq(shopProducts.id, '123'),
  with: { category: true }
})
console.log(product.category.name)
```

### hasMany (one-to-many)

**Use case:** One category has many products

```typescript
// Drizzle relation
export const shopCategoriesRelations = relations(shopCategories, ({ many }) => ({
  products: many(shopProducts)
}))

// Query
const category = await db.query.shopCategories.findFirst({
  where: eq(shopCategories.id, 'cat-123'),
  with: { products: true }
})
console.log(category.products.length)  // All products in this category
```

### hasOne (one-to-one)

**Use case:** One user has one profile

```typescript
// Schema
export const userProfiles = sqliteTable('user_profiles', {
  id: text('id').primaryKey(),
  userId: text('userId').notNull().unique()  // One-to-one
})

// Drizzle relation
export const usersRelations = relations(users, ({ one }) => ({
  profile: one(userProfiles, {
    fields: [users.id],
    references: [userProfiles.userId]
  })
}))
```

### manyToMany (advanced)

**Use case:** Products can have many tags, tags can belong to many products

```typescript
// Junction table
export const productTags = sqliteTable('product_tags', {
  productId: text('productId').notNull(),
  tagId: text('tagId').notNull()
})

// Relations
export const shopProductsRelations = relations(shopProducts, ({ many }) => ({
  productTags: many(productTags)
}))

export const productTagsRelations = relations(productTags, ({ one }) => ({
  product: one(shopProducts, {
    fields: [productTags.productId],
    references: [shopProducts.id]
  }),
  tag: one(tags, {
    fields: [productTags.tagId],
    references: [tags.id]
  })
}))

export const tagsRelations = relations(tags, ({ many }) => ({
  productTags: many(productTags)
}))

// Query (requires nested relations)
const product = await db.query.shopProducts.findFirst({
  with: {
    productTags: {
      with: {
        tag: true
      }
    }
  }
})
```

## When to Query Relations

### In the Component (Option 1)

**Best for:**
- ✅ Simple queries
- ✅ Data already cached
- ✅ Quick prototypes

::callout{type="tip" icon="i-lucide-book-open"}
**Query Examples**: For complete `useCollectionQuery` patterns, see [Data operations](/fundamentals/data-operations#reading-a-list).
::

```vue
<script setup lang="ts">
const { items: products } = await useCollectionQuery('shopProducts')
const { items: categories } = await useCollectionQuery('shopCategories')
// Map in component
</script>
```

### In the API Route (Option 2)

**Best for:**
- ✅ Complex joins
- ✅ Performance critical
- ✅ Large datasets
- ✅ Filtering by related fields

```typescript
// server/api/teams/[team]/products-full.get.ts
export default defineEventHandler(async (event) => {
  // Join on server, return combined data
  return await db.query.products.findMany({
    with: { category: true }
  })
})
```

**Rule of thumb:** Start with Option 1, move to Option 2 when you see performance issues.

## Related Topics

- [Working with Relations](/patterns/relations)
- [Form Patterns: Relation Dropdowns](/patterns/forms)
- [Table Patterns: Display Related Data](/patterns/tables)
