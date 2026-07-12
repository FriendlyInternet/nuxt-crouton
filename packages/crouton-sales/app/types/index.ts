/**
 * @crouton-package crouton-sales
 * @description Type definitions for the sales package
 */

export type { ProductOption, SalesProduct, CartItem, UsePosOrderOptions } from '../composables/usePosOrder'

// Order status enum — print_failed is set by the print-server fail callback
// when one of the order's tickets couldn't print; the complete callback flips
// the order to completed once all tickets have printed.
export type OrderStatus = 'pending' | 'processing' | 'completed' | 'cancelled' | 'print_failed'

// Print job status enum
export type PrintStatus = 0 | 1 | 2 | 9 // 0=pending, 1=printing, 2=done, 9=error

// Category type
export interface SalesCategory {
  id: string
  eventId: string
  title: string
  displayOrder?: number
}

// Location type (prep/print destination, e.g. "Bar", "Kitchen")
export interface SalesLocation {
  id: string
  title: string
  eventId?: string
}

// Order type
export interface SalesOrder {
  id: string
  eventId: string
  clientId?: string
  clientName?: string
  eventOrderNumber?: number
  overallRemarks?: string
  /** Free-text remark per location, keyed by locationId. Printed per location, not counted in sales. */
  locationRemarks?: Record<string, string>
  isPersonnel?: boolean
  status: OrderStatus
  createdAt?: string
  updatedAt?: string
}

// Client type
export interface SalesClient {
  id: string
  title: string
  isReusable?: boolean
}

// Printer type (opt-in)
export interface SalesPrinter {
  id: string
  eventId: string
  locationId: string
  title: string
  ipAddress: string
  port?: number
  /** kitchen = per-location tickets (default); receipt = combined customer receipt with footer */
  type?: 'kitchen' | 'receipt'
  status?: PrintStatus
  showPrices?: boolean
  isActive?: boolean
}

// Sales chart block attrs (CMS page block; see app.config.ts salesChartBlock)
export interface SalesChartBlockAttrs {
  /** Chart kind id from SALES_CHART_KINDS (e.g. 'revenue-by-day'). */
  chart?: string
  /** Event id to scope to, or '' for all events (team-wide). */
  eventScope?: string
  /** Optional chart type override; 'default' uses the kind's default. */
  chartTypeOverride?: 'default' | 'bar' | 'line' | 'area' | 'donut'
  title?: string
  height?: number | string
}

// Sales product × day matrix block attrs (CMS table block)
export interface SalesProductMatrixBlockAttrs {
  /** Event id to scope to, or '' for all events (team-wide). */
  eventScope?: string
  /** Default measure shown first; viewers can toggle on the page. */
  measure?: 'units' | 'revenue'
  title?: string
}
