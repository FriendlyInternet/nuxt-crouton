// The canary rig's packages/ target (#1878).
//
// This file exists so ONE canary can exercise the tests gate, which keys on
// `^packages/[^/]+/.*\.(ts|mjs|js)$` (planTestsGate, scripts/pi-finish.mjs) and therefore cannot
// be reached from a poc. Nothing here is used by anything. See README.md before "fixing" it.
//
// The shape below is the pattern a canary run is asked to REPEAT: one small pure function, plus
// its test in `test/`. That pairing is the whole point — #1885 was the pipeline shipping
// packages/ logic with none of its agreed tests while every check went green.

/** Clamp `n` into the inclusive range [min, max]. Pure; no dependencies. */
export function clamp(n: number, min: number, max: number): number {
  if (min > max) throw new RangeError(`clamp: min (${min}) is greater than max (${max})`)
  return Math.min(Math.max(n, min), max)
}
