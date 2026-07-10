// Database schema exports for crouton-printing.
// NuxtHub scans `server/db/schema.ts` across extended layers to build the
// bundled drizzle schema, so re-exporting here makes the consuming app pick up
// the generic `printers` + `print_jobs` tables in `db:generate` migrations
// automatically — no manual schema import needed in the app (same pattern as
// crouton-flow / crouton-sales).
export { printers, printJobs, printTransports } from '../database/schema'
