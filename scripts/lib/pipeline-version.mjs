// Pipeline v1 branch naming (#3461). A v1 epic branch is `epic/<n>--v1-<slug>`. The doubled `--` makes it
// unique: neither slug maker (epic-scaffold.mjs slugify, the decomposer's sed pipeline) ever produces `--`,
// so a branch named the current way can never look like v1. The `epic/<n>-` prefix is kept on purpose so
// every parser keyed on it (parseEpicNumber, revise-route, automerge-epic-subpr, on-issue-close) works unchanged.
// Pure.
export const epicBranchName = ({ epic, slug, version }) =>
  version === 'v1' ? `epic/${epic}--v1-${slug}` : `epic/${epic}-${slug}`

export const isV1Base = (ref) => /^epic\/\d+--v1-/.test(String(ref || ''))

// v1 is on unless the repo variable PIPELINE_V1 is `off`.
export const v1Enabled = (vars) => String(vars?.PIPELINE_V1 ?? '').trim().toLowerCase() !== 'off'
