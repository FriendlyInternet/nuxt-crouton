import { defineCroutonManifest } from '@fyit/crouton-core/shared/manifest'

export default defineCroutonManifest({
  id: 'crouton-printing',
  name: 'Printing',
  description: 'Domain-agnostic printing: a shared print-job queue, ESC/POS engine, output drivers, and on-site transport that any package can print through',
  icon: 'i-lucide-printer',
  version: '0.1.0',
  category: 'addon',
  aiHint: 'use when a package needs to print receipts/tickets/labels to thermal or browser printers; provides enqueuePrintJob() over a shared print-job queue',

  // Registers as 'printing' app — detectable via useCroutonApps().hasApp('printing')
  croutonApp: {
    id: 'printing',
  },

  provides: {
    components: [
      { name: 'CroutonPrintingTransportPicker', description: 'Per-event picker for which transport delivers thermal print jobs' },
    ],
  },

  // NuxtHub auto-discovers the printers + print_jobs tables via
  // server/db/schema.ts, which re-exports them from server/database/schema.ts.
  //
  // Server utils auto-imported into the merged nitro context (the print-job
  // queue API): enqueuePrintJob, enqueuePrintJobs, PRINT_STATUS — see
  // server/utils/print-job-queue.ts.
})
