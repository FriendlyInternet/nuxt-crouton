/** Shared shapes for the Sync components (Devices, DeviceList, Details, Status). */

/** A linked device (till / print router) from the grant list. */
export interface Device {
  deviceId: string
  type: string
  claimedAt: string | number | null
}

/** A device's freshness row from the sync-status feed. */
export interface SyncDevice {
  deviceId: string
  lastContactAt: number | null
  lastPullAt?: number | null
}

/** A config edit that lost a sync conflict. */
export interface LostEdit {
  id: string
  deviceId: string | null
  entityType: string
  entityId: string
  reason: string
  lost: Record<string, unknown>
  kept: Record<string, unknown>
  at: number
}
