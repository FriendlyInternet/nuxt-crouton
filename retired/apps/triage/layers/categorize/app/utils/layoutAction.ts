import type { InjectionKey } from 'vue'

export type LayoutAction = (action: 'view' | 'delete', ids?: string[]) => void
export const LAYOUT_ACTION_KEY: InjectionKey<LayoutAction> = Symbol('layoutAction')
