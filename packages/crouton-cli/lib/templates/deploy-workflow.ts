// deploy-workflow.ts — Generate GitHub Actions CI workflow for Cloudflare Pages deployment

interface WorkflowOptions {
  appName: string
  appDir: string
  productionUrl: string
  stagingUrl?: string
  withStaging: boolean
  layerPackages: string[]       // packages that need building (have build script)
  allExtendedPackages: string[] // all extended packages (for path filters)
  dbName: string                // D1 database name for migrations
  hasEnvBlock: boolean          // whether wrangler config has env block
}

/**
 * Generate the deploy workflow YAML content
 */
export function generateDeployWorkflow(opts: WorkflowOptions): string {
  const {
    appName,
    appDir,
    productionUrl,
    stagingUrl,
    withStaging,
    layerPackages,
    allExtendedPackages,
    dbName,
    hasEnvBlock,
  } = opts

  // Build path filters for push trigger
  const pathFilters = [
    `      - '${appDir}/**'`,
    ...allExtendedPackages.map(pkg => {
      const dirName = pkg.replace('@fyit/', '')
      return `      - 'packages/${dirName}/**'`
    }),
    `      - 'pnpm-lock.yaml'`,
    `      - '.github/workflows/deploy-${appName}.yml'`,
  ].join('\n')

  // Build layer cache paths
  const cachePaths = layerPackages
    .map(pkg => `            packages/${pkg.replace('@fyit/', '')}/dist`)
    .join('\n')

  // Build cache key hash files
  const cacheHashFiles = layerPackages
    .map(pkg => `packages/${pkg.replace('@fyit/', '')}/**/*.ts`)
    .join("', '")

  // Build layer build commands
  const buildCommands = layerPackages
    .map(pkg => `          pnpm --filter '${pkg}' build`)
    .join('\n')

  // Environment options for workflow_dispatch
  const envOptions = withStaging
    ? `          - staging
          - production`
    : `          - production`

  const defaultEnv = withStaging ? 'staging' : 'production'

  // Push trigger (only for staging)
  const pushTrigger = withStaging
    ? `  push:
    branches:
      - staging
    paths:
${pathFilters}
`
    : ''

  // Migration step
  const migrationStep = withStaging
    ? `      - name: Run database migrations
        run: |
          if [ "\${{ inputs.environment || '${defaultEnv}' }}" = "production" ]; then
            npx wrangler d1 migrations apply DB --remote
          else
            npx wrangler d1 migrations apply DB --env preview --remote
          fi
        working-directory: ${appDir}`
    : `      - name: Run database migrations
        run: npx wrangler d1 migrations apply DB --remote
        working-directory: ${appDir}`

  // Build env vars
  const buildEnvLines = [`          NODE_OPTIONS: '--max-old-space-size=8192'`, `          NITRO_PRESET: 'cloudflare-pages'`]

  if (withStaging) {
    buildEnvLines.push(
      `          CLOUDFLARE_ENV: \${{ (inputs.environment || '${defaultEnv}') == 'staging' && 'preview' || '' }}`,
      `          BETTER_AUTH_URL: \${{ (inputs.environment || '${defaultEnv}') == 'production' && '${productionUrl}' || '${stagingUrl || ''}' }}`,
    )
  } else {
    buildEnvLines.push(
      `          BETTER_AUTH_URL: '${productionUrl}'`,
    )
  }

  // Strip-env step (only if wrangler has env block)
  const stripEnvStep = hasEnvBlock
    ? `
      # Workaround: Wrangler 4.64+ rejects env blocks in redirected configs.
      # Nitro copies the full wrangler config (including env) into the generated
      # _worker.js/wrangler.json. Strip it so deploy succeeds.
      - name: Strip env from redirected wrangler config
        run: |
          CONFIG="dist/_worker.js/wrangler.json"
          if [ -f "$CONFIG" ] && grep -q '"env"' "$CONFIG"; then
            node -e "
              const fs = require('fs');
              const cfg = JSON.parse(fs.readFileSync('$CONFIG', 'utf8'));
              delete cfg.env;
              fs.writeFileSync('$CONFIG', JSON.stringify(cfg, null, 2));
            "
          fi
        working-directory: ${appDir}
`
    : ''

  // Deploy step
  const deployStep = withStaging
    ? `      - name: Deploy to Cloudflare Pages
        run: |
          if [ "\${{ inputs.environment || '${defaultEnv}' }}" = "production" ]; then
            npx wrangler pages deploy dist/ --commit-dirty=true
          else
            npx wrangler pages deploy dist/ --commit-dirty=true --branch staging
          fi
        working-directory: ${appDir}`
    : `      - name: Deploy to Cloudflare Pages
        run: npx wrangler pages deploy dist/ --commit-dirty=true
        working-directory: ${appDir}`

  return `name: Deploy ${appName[0].toUpperCase() + appName.slice(1)}

on:
${pushTrigger}  workflow_dispatch:
    inputs:
      environment:
        description: 'Deploy target'
        required: true
        default: '${defaultEnv}'
        type: choice
        options:
${envOptions}

jobs:
  deploy:
    name: Deploy to \${{ inputs.environment || '${defaultEnv}' }}
    runs-on: ubuntu-latest
    environment: \${{ inputs.environment || '${defaultEnv}' }}
    env:
      CLOUDFLARE_ACCOUNT_ID: \${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
      CLOUDFLARE_API_TOKEN: \${{ secrets.CLOUDFLARE_API_TOKEN }}
    steps:
      - uses: actions/checkout@v7

      - name: Setup pnpm
        uses: pnpm/action-setup@v6

      - name: Setup Node.js
        uses: actions/setup-node@v7
        with:
          node-version: '20'
          cache: 'pnpm'

      - name: Install dependencies
        run: pnpm install --frozen-lockfile --ignore-scripts
${layerPackages.length > 0 ? `
      - name: Cache layer builds
        id: layer-cache
        uses: actions/cache@v6
        with:
          path: |
${cachePaths}
          key: layer-builds-\${{ hashFiles('${cacheHashFiles}') }}

      - name: Build layer packages
        if: steps.layer-cache.outputs.cache-hit != 'true'
        run: |
${buildCommands}
` : ''}
      - name: Cache Nuxt build artifacts
        uses: actions/cache@v6
        with:
          path: |
            ${appDir}/node_modules/.cache
            ${appDir}/.nuxt/cache
          key: nuxt-build-${appName}-\${{ hashFiles('${appDir}/**', 'packages/**/*.ts') }}
          restore-keys: |
            nuxt-build-${appName}-

${migrationStep}

      - name: Build
        run: npx nuxt build
        working-directory: ${appDir}
        env:
${buildEnvLines.join('\n')}
${stripEnvStep}${deployStep}
`
}
