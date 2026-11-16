// Should the auto-merge workflow act on this event? (#3229)
// A `labeled` pull_request event fires for EVERY label; only `build:approved` (the reviewer's
// approval, added by build-review.yml with the App token so the event fires) is worth a run.
// Every other event reaching the script has already passed the job-level `if:`.
export const APPROVAL_LABEL = 'build:approved'

export function shouldRunOnEvent(eventName, payload = {}) {
  if (eventName === 'pull_request' && payload.action === 'labeled') {
    return payload.label?.name === APPROVAL_LABEL
  }
  return true
}
