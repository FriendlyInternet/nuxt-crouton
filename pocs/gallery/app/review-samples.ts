// Sample inputs for gallery review pages (#2462): piece name → the props it is shown with.
//
// Most pieces need nothing here: page blocks fill themselves from their registered default
// content, and a piece missing a required input says which one instead of rendering blank.
// Add a line when a piece needs something to look like itself — one line per piece, plain data.
// A `?props={...}` query on the review link still wins over what's here.
export const reviewSamples: Record<string, Record<string, unknown>> = {
  CroutonUserPill: { placement: 'inline' },
  TeamColorSwatchPicker: { colors: ['#ef4444', '#3b82f6', '#22c55e', '#f59e0b', '#8b5cf6'], modelValue: '#3b82f6' },
}
