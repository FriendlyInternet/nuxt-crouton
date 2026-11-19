export type EventOperation = 'create' | 'update' | 'delete'

export interface EventChange {
  fieldName: string
  oldValue: string | null
  newValue: string | null
}

export interface CroutonEvent {
  id: string
  timestamp: string | Date
  operation: EventOperation
  collectionName: string
  itemId: string
  userId: string
  userName: string
  changes: EventChange[]
  metadata?: Record<string, unknown>
}

export interface FilterState {
  collectionName?: string
  operation?: EventOperation | ''
  userId?: string
  dateFrom?: Date
  dateTo?: Date
}
