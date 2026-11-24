/**
 * @crouton-package crouton-sales
 * @description Pick the event slug a scoped page's blocks point at (#4480) —
 * the page gate redeems that event's helper PIN. Both the till
 * (`eventWorkspaceBlock`) and the kitchen screen (`kitchenDisplayBlock`) count;
 * the first one with a non-empty `eventSlug` wins. Pure, so vitest can load it.
 */
type Block = { type?: string, attrs?: Record<string, unknown> }

const SCOPED_BLOCK_TYPES = new Set(['eventWorkspaceBlock', 'kitchenDisplayBlock'])

const isScoped = (block: Block | null | undefined) => SCOPED_BLOCK_TYPES.has(String(block?.type))
const trimmed = (value: unknown) => (typeof value === 'string' ? value.trim() : '')

export function scopedEventSlug(blocks: Block[]): string | undefined {
  return (blocks ?? [])
    .filter(isScoped)
    .map(block => trimmed(block.attrs?.eventSlug))
    .find(Boolean)
}
