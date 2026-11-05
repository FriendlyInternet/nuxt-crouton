# @fyit/crouton-devtools

DevTools integration for Nuxt Crouton - visual inspection and management of CRUD collections.

## Features

- 🔍 **Collection Inspector** - View all registered collections in your app
- 📊 **Configuration Details** - Inspect collection schemas, metadata, and settings
- 🎨 **Beautiful UI** - Professional design with smooth animations and dark mode support
- 🔎 **Search & Filter** - Quickly find collections by name, layer, or API path
- ♻️ **Refresh on Demand** - Update collection data without reloading
- 🌙 **Dark Mode** - Automatic dark mode support
- 🚀 **Zero Config** - Works automatically when DevTools is enabled

## Installation

```bash
pnpm add -D @fyit/crouton-devtools
```

## Usage

Add the module to your `nuxt.config.ts`:

```typescript
export default defineNuxtConfig({
  modules: [
    '@nuxt/devtools',
    '@fyit/crouton-devtools'
  ],

  devtools: {
    enabled: true
  }
})
```

That's it! The DevTools integration will automatically appear in your Nuxt DevTools when you run your app in development mode.

## What You'll See

### Collection Inspector

The main view shows all collections registered in your `app.config.croutonCollections`:

- **Collection Cards** - Quick overview of each collection
- **Search & Filter** - Find collections by name, layer, or API path
- **Layer Badges** - Visual indicators for internal/external/custom collections
- **Detail View** - Click any collection to see full configuration

### Collection Details

Each collection displays:

- Name and key
- API path
- Component name (for internal collections)
- Layer type
- Full JSON configuration
- Metadata and custom fields

## Development

This package only runs in development mode and has zero impact on your production builds.

## Requirements

- Nuxt 4+
- @nuxt/devtools
- @fyit/crouton-core

## Roadmap

This is Phase 1 (MVP) of the DevTools integration. Future phases will include:

- **Phase 2**: CRUD operations monitoring, API endpoint testing
- **Phase 3**: Collection data browser with inline editing
- **Phase 4**: Generator history and rollback management
- **Phase 5**: Schema validation debugger, i18n manager

## License

MIT

## Contributing

Contributions are welcome! Please see the [main repository](https://github.com/FriendlyInternet/nuxt-crouton) for guidelines.
