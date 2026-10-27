// Sample inputs for gallery review pages (#2462): piece name → the props it is shown with.
//
// Most pieces need nothing here: page blocks fill themselves from their registered default
// content, and a piece missing a required input says which one instead of rendering blank.
// Add a line when a piece needs something to look like itself — one line per piece, plain data.
// A `?props={...}` query on the review link still wins over what's here.
export const reviewSamples: Record<string, Record<string, unknown>> = {
  TeamColorSwatchPicker: { colors: ['red', 'blue', 'green', 'amber', 'violet'], modelValue: 'blue' },
  CollabPresence: { users: [{ user: { id: 'u0', name: 'Ada Lovelace' } }, { user: { id: 'u1', name: 'Grace Hopper' } }, { user: { id: 'u2', name: 'Alan Turing' } }, { user: { id: 'u3', name: 'Linus Torvalds' } }, { user: { id: 'u4', name: 'Margaret Hamilton' } }, { user: { id: 'u5', name: 'Tim Berners-Lee' } }], maxVisible: 3 },
}
