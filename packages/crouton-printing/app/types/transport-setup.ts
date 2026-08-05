/**
 * Per-flow setup guide (#1364) rendered by <CroutonPrintingTransportSetupPanel>
 * under the transport picker. Content arrives fully translated from the
 * embedding domain (this package ships no i18n) and must mirror the
 * checklists in print-server/README.md (see the sync note there).
 */

export type PrintTransportValue = 'local-drainer' | 'router-spooler' | 'none'

export interface TransportSetupStep {
  /** Checklist line, already translated by the embedding domain. */
  text: string
  /** Copyable value rendered as a mono chip (event id, app URL, env var name, command). */
  value?: string
  /** Short mono label naming what the value is (e.g. "EVENT_ID"). */
  valueLabel?: string
  /** Marks the verification step — rendered with the flow's live heartbeat dot. */
  verify?: boolean
}

export interface TransportSetupGuide {
  value: PrintTransportValue
  /** Optional one-line intro above the checklist. */
  intro?: string
  steps: TransportSetupStep[]
}
