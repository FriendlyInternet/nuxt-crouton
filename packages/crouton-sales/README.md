# @fyit/crouton-sales

Event-based Point of Sale (POS) system for Nuxt Crouton. Provides products, categories, orders, and optional thermal receipt printing.

## Features

- Product catalog with categories and options
- Shopping cart with quantity management
- Order processing with customer info
- Helper authentication (PIN-based for event staff)
- Optional thermal receipt printing (ESC/POS)
- Team-based multi-tenancy
- i18n support (EN/NL)

## Installation

```bash
pnpm add @fyit/crouton-sales
```

## Quick Start

### 1. Copy Schemas

Copy schema files from this package to your project's `./schemas/` directory:

```bash
cp node_modules/@fyit/crouton-sales/schemas/*.json ./schemas/
```

Available schemas:
- `events.json` - Events/pop-ups with helper PIN
- `products.json` - Products with pricing and options
- `categories.json` - Product categories
- `orders.json` - Customer orders
- `orderItems.json` - Order line items
- `locations.json` - Physical locations/stations
- `clients.json` - Customers/clients
- `eventSettings.json` - Per-event configuration
- `printers.json` (optional) - Thermal printers
- `printQueues.json` (optional) - Print job queue

### 2. Configure Crouton

Create `crouton.config.js`:

```javascript
export default {
  dialect: 'sqlite',  // or 'pg' for PostgreSQL

  collections: [
    { name: 'events', fieldsFile: './schemas/events.json' },
    { name: 'products', fieldsFile: './schemas/products.json' },
    { name: 'categories', fieldsFile: './schemas/categories.json' },
    { name: 'orders', fieldsFile: './schemas/orders.json' },
    { name: 'orderItems', fieldsFile: './schemas/orderItems.json' },
    { name: 'locations', fieldsFile: './schemas/locations.json' },
    { name: 'clients', fieldsFile: './schemas/clients.json' },
    { name: 'eventSettings', fieldsFile: './schemas/eventSettings.json' }
  ],

  targets: [
    {
      layer: 'sales',  // MUST use 'sales' as layer name
      collections: [
        'events', 'products', 'categories', 'orders',
        'orderItems', 'locations', 'clients', 'eventSettings'
      ]
    }
  ],

  flags: {
    useTeamUtility: true,   // Adds teamId/userId fields
    useMetadata: true,      // Adds createdAt/updatedAt
    noTranslations: true    // Skip i18n fields
  }
}
```

### 3. Generate Collections

```bash
crouton config
```

This creates `./layers/sales/` with all CRUD components, composables, and API endpoints.

### 4. Configure Nuxt

```typescript
// nuxt.config.ts
export default defineNuxtConfig({
  extends: [
    '@fyit/crouton-core',  // bundles crouton-auth (helper auth)
    '@fyit/crouton-sales',
    './layers/sales'  // Your generated layer
  ]
})
```

## Optional: Enable Printing

For thermal receipt printing, add printer schemas to your config:

```javascript
// crouton.config.js
export default {
  collections: [
    // ... existing collections ...
    { name: 'printers', fieldsFile: './schemas/printers.json' },
    { name: 'printQueues', fieldsFile: './schemas/printQueues.json' }
  ],

  targets: [
    {
      layer: 'sales',
      collections: [
        // ... existing ...
        'printers', 'printQueues'
      ]
    }
  ]
}
```

Enable in nuxt.config:

```typescript
export default defineNuxtConfig({
  croutonSales: {
    print: { enabled: true }
  }
})
```

## Components

Components are auto-imported with `Sales` prefix.

### Customer Interface (`Client/`)

| Component | Usage | Description |
|-----------|-------|-------------|
| `<SalesClientCart />` | Shopping cart display | Shows cart items with quantity controls |
| `<SalesClientProductList />` | Product grid | Displays products with inline option selection |
| `<SalesClientCategoryTabs />` | Category navigation | Tabs for filtering products by category |
| `<SalesClientProductOptionsSelect />` | Options dialog | Product variant/option selection |
| `<SalesClientCartTotal />` | Order total | Shows item count and total price |
| `<SalesClientOrderInterface />` | Main order page | Combines all customer components |
| `<SalesClientSelector />` | Client selector | Dropdown with create-on-type |
| `<SalesClientOfflineBanner />` | Offline indicator | Shows when connection is lost |

### Order Management (`Pos/`)

| Component | Usage | Description |
|-----------|-------|-------------|
| `<SalesPosOrdersList />` | Orders table | Orders with status filtering and auto-refresh |

### Admin (`Admin/`)

| Component | Usage | Description |
|-----------|-------|-------------|
| `<SalesAdminPosSidebar />` | Navigation | Admin sidebar with links |

### Print Settings (`Settings/`) - Optional

| Component | Usage | Description |
|-----------|-------|-------------|
| `<SalesSettingsReceiptSettingsModal />` | Receipt config | Receipt text customization |
| `<SalesSettingsPrintPreviewModal />` | Receipt preview | Preview with test print button |

## Composables

### From Package

#### `usePosOrder(options?)`

Cart management and checkout functionality.

```typescript
const {
  cartItems,           // readonly Ref<CartItem[]>
  cartTotal,           // computed total price
  cartItemCount,       // computed item count
  isEmpty,             // computed boolean
  selectedEventId,     // Ref<string | null>
  selectedClientId,    // Ref<string | null>
  selectedClientName,  // Ref<string | null>
  overallRemarks,      // Ref<string | null>
  isPersonnel,         // Ref<boolean>
  isCheckingOut,       // readonly Ref<boolean>

  addToCart,           // (product, remarks?, options?) => void
  removeFromCart,      // (index) => void
  updateQuantity,      // (index, quantity) => void
  clearCart,           // () => void
  getItemPrice,        // (item) => number
  getItemTotal,        // (item) => number
  checkout             // () => Promise<CreateOrderResponse>
} = usePosOrder({
  apiBasePath: '/api/sales/events',  // default
  enablePrinting: false              // default
})

// Example usage
addToCart(product, 'Extra sauce', ['option-1'])
selectedEventId.value = 'event-123'
const order = await checkout()
```

#### `useHelperAuth()`

Helper (staff) authentication for event access.

```typescript
const {
  isHelper,       // computed boolean
  helperName,     // computed string
  eventId,        // computed string
  teamId,         // computed string
  token,          // computed string
  isLoading,      // readonly Ref<boolean>
  error,          // readonly Ref<string | null>

  login,          // (options) => Promise<boolean>
  logout,         // () => Promise<void>
  validateToken   // () => Promise<boolean>
} = useHelperAuth()

// Login with PIN
const success = await login({
  teamId: 'team-123',
  eventId: 'event-456',
  pin: '1234',
  helperName: 'John'  // for new helpers
  // OR helperId: 'existing-id'  // for returning helpers
})

// Check authentication
if (isHelper.value) {
  console.log(`Welcome, ${helperName.value}!`)
}

// Logout
await logout()
```

### From Generated Layer

After running `crouton config`, your `./layers/sales/` will have:

- `useSalesEvents()` - Event CRUD
- `useSalesProducts()` - Product CRUD
- `useSalesCategories()` - Category CRUD
- `useSalesOrders()` - Order CRUD
- `useSalesOrderitems()` - Order item CRUD
- `useSalesLocations()` - Location CRUD
- `useSalesClients()` - Client CRUD
- `useSalesEventsettings()` - Event settings CRUD
- `useSalesPrinters()` - Printer CRUD (if enabled)
- `useSalesPrintqueues()` - Print queue CRUD (if enabled)

## Helper Authentication Flow

1. **Admin creates event** with a `helperPin` field
2. **Helper accesses login page** for the event
3. **Helper enters PIN** and their name
4. **Server validates PIN** and creates scoped access token
5. **Helper can now take orders** for that event
6. **Token expires** after 8 hours (configurable)

### Server-side Validation

```typescript
// In API handlers
import { requireScopedAccess } from '@fyit/crouton-auth/server'

export default defineEventHandler(async (event) => {
  const access = await requireScopedAccess(event, 'pos-helper-token')

  // access.displayName - Helper's name
  // access.resourceId - Event ID
  // access.organizationId - Team ID
  // access.role - 'helper'
})
```

### Event Schema Requirements

Your events schema should include a `helperPin` field:

```json
{
  "helperPin": {
    "type": "string",
    "meta": {
      "label": "Helper PIN",
      "maxLength": 6,
      "help": "PIN for helper authentication"
    }
  }
}
```

## Database Table Naming

The package expects tables with `sales` prefix:

- `salesEvents`
- `salesProducts`
- `salesCategories`
- `salesOrders`
- `salesOrderitems`
- `salesLocations`
- `salesClients`
- `salesEventsettings`
- `salesPrinters` (if print enabled)
- `salesPrintqueues` (if print enabled)

This is why the `layer: 'sales'` configuration is **required**.

## Dependencies

### Required
- `@fyit/crouton-core` - Core layer (bundles `@fyit/crouton-auth`, used for helper authentication)
- `@nuxtjs/i18n` ^9.0.0 or ^10.0.0
- `zod` ^3.0.0

### Optional
- `node-thermal-printer` ^4.0.0 - For receipt printing

## License

MIT
