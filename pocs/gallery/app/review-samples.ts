// Sample inputs for gallery review pages (#2462): piece name → the props it is shown with.
//
// Most pieces need nothing here: page blocks fill themselves from their registered default
// content, and a piece missing a required input says which one instead of rendering blank.
// Add a line when a piece needs something to look like itself — one line per piece, plain data.
// A `?props={...}` query on the review link still wins over what's here.
export const reviewSamples: Record<string, Record<string, unknown>> = {
  TeamColorSwatchPicker: { colors: ['red', 'blue', 'green', 'amber', 'violet'], modelValue: 'blue' },
  CollabPresence: { users: [{ user: { id: 'u0', name: 'Ada Lovelace' } }, { user: { id: 'u1', name: 'Grace Hopper' } }, { user: { id: 'u2', name: 'Alan Turing' } }, { user: { id: 'u3', name: 'Linus Torvalds' } }, { user: { id: 'u4', name: 'Margaret Hamilton' } }, { user: { id: 'u5', name: 'Tim Berners-Lee' } }], maxVisible: 3 },
  // 3 users; `?props={"users":[...1 or 6...]}` on the link shows the other counts
  CollabEditingBadge: { roomId: 'review', variant: 'avatars', users: [{ user: { id: 'u0', name: 'Ada Lovelace' } }, { user: { id: 'u1', name: 'Grace Hopper' } }, { user: { id: 'u2', name: 'Alan Turing' } }] },
  // Sales sync (#806): Details/DeviceList take plain data; Status polls the server, so it needs the signed-in app.
  SalesSyncDetails: { devices: [{ deviceId: 'device:a1b2c3d4e5', lastContactAt: 1_700_000_000_000, lastPullAt: 1_699_999_900_000 }], lostEdits: [], now: 1_700_000_060_000, showEmpty: true },
  SalesSyncDeviceList: { devices: [{ deviceId: 'device:a1b2c3d4e5', type: 'till', claimedAt: 1_699_000_000_000 }, { deviceId: 'f6e5d4c3b2', type: 'print-device', claimedAt: 1_699_000_000_000 }], syncDevices: [{ deviceId: 'device:a1b2c3d4e5', lastContactAt: 1_700_000_000_000, lastPullAt: 1_699_999_900_000 }], now: 1_700_000_060_000 },
  SalesSyncStatus: { teamParam: 'review' },
}
