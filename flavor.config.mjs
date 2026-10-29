/**
 * Harness flavor — epic #2882 / WS1 (#2884).
 *
 * The stack answers the pipeline needs, declared in one place instead of inline shell
 * and prompt text across work-issue-pidev, decompose-on-issue-pidev, ci, e2e and the
 * review gates. `harness.config.mjs` answers "what stage is this path?"; this file
 * answers "how does this stack install, check, test and name things?".
 *
 * This is the crouton (Nuxt + pnpm + Cloudflare) profile, copied VERBATIM from the
 * workflows as they stand today. Declaring it changes no behaviour; later workstreams
 * (#2882 WS2/WS3) point the workflows at `scripts/harness-flavor.mjs <key>` instead of
 * their inline copies. A second stack ships its own flavor file.
 *
 * Patterns are strings (regex source / globs) so the resolver can print them and a
 * shell caller can read them; JS callers compile with `new RegExp(...)`.
 */
export const flavor = {
  // work-issue-pidev "Install" step.
  install: 'pnpm install --frozen-lockfile',

  // work-issue-pidev "Warm @fyit package builds" step (composite action; cache-miss
  // command is `pnpm build:packages`).
  warm: {
    action: './.github/actions/warm-packages',
    command: 'pnpm build:packages'
  },

  // Acceptance typecheck on the touched app.
  typecheck: {
    // Which top-level dirs hold an app a diff can be typechecked through
    // (scripts/pi-finish.mjs planAcceptance): `^(apps|pocs)/<name>/`.
    appPattern: '^(apps|pocs)/([^/]+)/',
    // Link the app into the workspace first (a fresh poc was never installed), then run
    // the app's OWN typecheck script. `{pkg}` = the app's package.json name.
    prepare: 'pnpm install --filter "{pkg}..." --no-frozen-lockfile',
    command: 'pnpm --filter "{pkg}" typecheck',
    // Whole-repo sweep (ci.yml "Type Check Apps").
    all: 'pnpm typecheck',
    // A shared-package-only change touches no app: borrow the first member of these roots
    // (sorted) that has a typecheck script and depends on the changed package (#2709).
    borrowConsumer: {
      sharedRoot: 'packages',
      consumerRoots: ['apps', 'fixtures'],
      requireScript: 'typecheck'
    }
  },

  // Tests gate (#1885): hand-written logic in the shared stage that landed with no test.
  testsGate: {
    logicPaths: '^packages/[^/]+/.*\\.(ts|mjs|js)$',
    // A path matching this counts as a test file, and never as logic.
    testPaths: '(^|/)(test|tests|__tests__)/|\\.(test|spec)\\.',
    // i18n locale JSON and .vue never match logicPaths (extension), so a label-only
    // change is not held and a visual change answers to the UI gate instead.
    exclude: ['**/i18n/locales/*.json', '**/*.vue']
  },

  // Commit split (#1849): hand-authored inputs vs generator output, minus junk.
  generated: {
    // Generator output = every changed path that pi did not author via edit/write.
    // Junk never committed (scripts/pi-edited-files.mjs DENY):
    junk: '(^|/)(\\.pi|node_modules|\\.nuxt|\\.output|dist)(/|$)|decompose-pidev-(prompt|exec)-\\d+\\.(txt|log)|(^|/)pi-telemetry-out(/|$)',
    generators: ['crouton config', 'generate_collection'],
    commitSubject: 'generate: derived output'
  },

  // Identity the pipeline commits and comments as.
  bot: {
    name: 'nuxt-harness[bot]',
    email: 'nuxt-harness[bot]@users.noreply.github.com'
  },

  // Label prefixes (.github/labels.yml) and conventional-commit scopes (CLAUDE.md).
  labels: {
    prefixes: ['pkg:', 'app:', 'worker:', 'type:', 'meta:', 'status:'],
    commitScopes: [
      'crouton', 'crouton-core', 'crouton-cli', 'crouton-i18n', 'crouton-editor',
      'crouton-flow', 'crouton-assets', 'crouton-devtools', 'crouton-auth',
      'crouton-pages', 'crouton-bookings', 'docs', 'playground', 'rakim', 'root'
    ]
  },

  // Where shared dependency versions are pinned (dependency-sweep skill).
  catalog: {
    file: 'pnpm-workspace.yaml',
    key: 'catalog'
  },

  // Deploy per stage (names match harness.config.mjs `stages`). Hosts are templates
  // over `{app}`.
  deploy: {
    poc: { target: 'preview', workflow: 'deploy-pocs.yml' },
    app: { target: 'staging', workflow: 'deploy-app.yml' },
    package: { target: 'none' },
    hosts: {
      staging: '{app}.pmcp.dev',
      production: '{app}.friendlyinter.net'
    }
  },

  // Per-PR review gates: path filters (GitHub `paths:` syntax) + the prompt file each
  // runs. Gates keep separate runs and separate prompts.
  reviewGates: {
    'red-team': {
      paths: [
        '**/server/**', '**/app/**', '**/nuxt.config.ts',
        'packages/**', 'apps/**', 'pocs/**', '!.claude/gate-fixtures/**'
      ],
      prompt: '.claude/agents/red-team.md'
    },
    a11y: {
      paths: ['**/*.vue', '!.claude/gate-fixtures/**'],
      prompt: '.claude/agents/a11y.md'
    },
    'frontend-review': {
      paths: ['**/*.vue', '!.claude/gate-fixtures/**'],
      prompt: '.claude/agents/frontend-review.md'
    }
  }
}

export default flavor
