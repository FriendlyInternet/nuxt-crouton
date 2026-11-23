/**
 * Troubleshooting Resource
 */
export default defineMcpResource({
  uri: 'crouton://troubleshooting',
  name: 'Crouton Troubleshooting Guide',
  description: 'Common issues and solutions when using Crouton',
  mimeType: 'text/markdown',
  async handler() {
    return {
      contents: [{
        uri: 'crouton://troubleshooting',
        mimeType: 'text/markdown',
        text: `# Crouton Troubleshooting Guide

## Generation Issues

### "Layer not found" Error

**Problem**: \`Error: Layer 'shop' does not exist\`

**Solution**:
1. Create the layer directory: \`mkdir -p layers/shop\`
2. Add a basic \`nuxt.config.ts\` in the layer
3. Register in root \`nuxt.config.ts\`:
   \`\`\`typescript
   export default defineNuxtConfig({
     extends: ['./layers/shop']
   })
   \`\`\`

---

### "Invalid field type" Error

**Problem**: \`Error: Invalid field type 'select'\`

**Solution**: Crouton only supports these types:
- \`string\`, \`text\`, \`number\`, \`decimal\`, \`boolean\`, \`date\`, \`json\`, \`repeater\`, \`array\`

For select/dropdown fields, use \`string\` type with \`meta.options\` and \`meta.displayAs: "optionsSelect"\` — without \`displayAs\` the field renders as a plain text input.

---

### Schema JSON Parse Error

**Problem**: \`SyntaxError: Unexpected token in JSON\`

**Solution**:
1. Validate your JSON: \`cat schema.json | jq .\`
2. Common issues:
   - Trailing commas
   - Unquoted keys
   - Single quotes instead of double quotes
3. Use the \`validate_schema\` tool to check

---

### Files Not Generated

**Problem**: Command runs but no files appear

**Solution**:
1. Check the output path - files go to \`layers/[layer]/collections/[collection]/\`
2. Use \`--dry-run\` to see what would be generated
3. Check for existing files (use \`--force\` to overwrite)

---

## Runtime Issues

### "Cannot find module" Error

**Problem**: \`Error: Cannot find module '#crouton/products'\`

**Solution**:
1. Run \`npx nuxt prepare\` to regenerate types
2. Check that the layer is properly extended in \`nuxt.config.ts\`
3. Restart the dev server

---

### API Returns 404

**Problem**: API endpoints return 404

**Solution**:
1. Check API route path: \`/api/teams/[teamId]/[layer]-[collection]/\`
2. Ensure you're passing a valid team ID
3. Check server logs for route registration

---

### Form Validation Not Working

**Problem**: Form submits without validation

**Solution**:
1. Check Zod schema is properly imported
2. Ensure \`@submit\` handler calls \`validate()\`
3. Check browser console for Zod errors

---

### Database Schema Errors

**Problem**: Drizzle migration fails

**Solution**:
1. Check dialect matches your database (\`--dialect=pg\` or \`--dialect=sqlite\`)
2. Review generated schema in \`server/database/schema.ts\`
3. Run \`npx drizzle-kit generate:pg\` (or sqlite) to see migration

---

## TypeScript Issues

### Missing Types

**Problem**: TypeScript can't find generated types

**Solution**:
\`\`\`bash
# Regenerate types
npx nuxt prepare

# Check tsconfig.json includes layers
\`\`\`

---

### Type Inference Not Working

**Problem**: Composables return \`any\` type

**Solution**:
1. Ensure \`types.ts\` was generated in the collection
2. Check imports in composable file
3. Run \`npx nuxt typecheck\` to find issues

---

## Database Issues

### SQLite "table already exists"

**Problem**: \`SqliteError: table products already exists\`

**Solution**:
1. Drop the existing table manually
2. Or use a fresh database file
3. Delete \`.data/db.sqlite\` for local dev

---

### PostgreSQL Connection Failed

**Problem**: \`Error: connect ECONNREFUSED\`

**Solution**:
1. Check \`DATABASE_URL\` in \`.env\`
2. Ensure PostgreSQL is running
3. Check connection string format:
   \`\`\`
   postgresql://user:password@localhost:5432/dbname
   \`\`\`

---

## Team Authentication Issues

### "Team not found" Error

**Problem**: All API calls return team not found

**Solution**:
1. Ensure \`@crouton/auth\` is installed
2. Check team ID in route parameter
3. Verify user has team membership

---

### Permission Denied

**Problem**: 403 Forbidden on API calls

**Solution**:
1. Check user is authenticated
2. Verify team membership with correct role
3. Check API endpoint permission requirements

---

## Performance Issues

### Slow Initial Load

**Problem**: First page load is slow

**Solution**:
1. Use \`useLazyFetch\` instead of \`useFetch\`
2. Implement pagination - don't load all items
3. Add loading skeletons for better UX

---

### Large Bundle Size

**Problem**: Bundle is larger than expected

**Solution**:
1. Lazy load modal components
2. Use dynamic imports for heavy dependencies
3. Check if you're importing unused composables

---

## Getting Help

If you can't find a solution:

1. **Search documentation**: Use \`search_docs\` tool
2. **Check generated code**: Review the actual generated files
3. **Enable debug mode**: Set \`DEBUG=crouton:*\` environment variable
4. **Check GitHub issues**: Search for similar problems
5. **Ask in discussions**: Post with full error message and reproduction steps
`
      }]
    }
  }
})
