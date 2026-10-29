#!/bin/bash
# layer: stack

# Publish all @fyit/crouton-* packages to npm in dependency order
# Usage: ./scripts/publish-packages.sh [--dry-run] [--skip-build] [--skip-typecheck]

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Parse arguments
DRY_RUN=false
SKIP_BUILD=false
SKIP_TYPECHECK=false

for arg in "$@"; do
  case $arg in
    --dry-run)
      DRY_RUN=true
      ;;
    --skip-build)
      SKIP_BUILD=true
      ;;
    --skip-typecheck)
      SKIP_TYPECHECK=true
      ;;
  esac
done

# Get script directory and project root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
PACKAGES_DIR="$PROJECT_ROOT/packages"

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}  @fyit/crouton Package Publisher${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

if [ "$DRY_RUN" = true ]; then
  echo -e "${YELLOW}🔍 DRY RUN MODE - No packages will be published${NC}"
  echo ""
fi

# Packages in dependency order
# 1. Core first
# 2. Bundled add-ons (auth, admin, i18n)
# 3. Optional add-ons
# 4. Tooling
# 5. Mini-apps
# 6. Unified module (last)

PACKAGES=(
  # 1. Core packages
  "crouton-core"
  "crouton-cli"

  # 2. Bundled add-ons
  "crouton-auth"
  "crouton-admin"
  "crouton-i18n"

  # 3. Optional add-ons
  "crouton-editor"
  "crouton-flow"
  "crouton-assets"
  "crouton-devtools"
  "crouton-maps"
  "crouton-ai"
  "crouton-email"
  "crouton-events"
  "crouton-collab"
  "crouton-pages"

  # 4. Tooling
  "crouton-schema-designer"
  "crouton-themes"
  "crouton-mcp"

  # 5. Mini-apps
  "crouton-bookings"
  "crouton-sales"

  # 6. Unified module (MUST be last)
  "crouton"
)

echo -e "${BLUE}Packages to publish (in order):${NC}"
for i in "${!PACKAGES[@]}"; do
  echo "  $((i+1)). @fyit/${PACKAGES[$i]}"
done
echo ""

# Step 1: Build all packages
if [ "$SKIP_BUILD" = false ]; then
  echo -e "${BLUE}📦 Step 1: Building all packages...${NC}"
  cd "$PROJECT_ROOT"
  if [ "$DRY_RUN" = true ]; then
    echo "  Would run: pnpm -r build"
  else
    pnpm -r build
  fi
  echo -e "${GREEN}✓ Build complete${NC}"
  echo ""
else
  echo -e "${YELLOW}⏭️  Skipping build (--skip-build)${NC}"
  echo ""
fi

# Step 2: Typecheck (optional but recommended)
if [ "$SKIP_TYPECHECK" = false ]; then
  echo -e "${BLUE}🔍 Step 2: Running typecheck...${NC}"
  cd "$PROJECT_ROOT"
  if [ "$DRY_RUN" = true ]; then
    echo "  Would run: pnpm -r typecheck"
  else
    # Note: Not all packages have typecheck, so we use || true
    pnpm -r typecheck || echo -e "${YELLOW}⚠️  Some typecheck warnings (continuing)${NC}"
  fi
  echo -e "${GREEN}✓ Typecheck complete${NC}"
  echo ""
else
  echo -e "${YELLOW}⏭️  Skipping typecheck (--skip-typecheck)${NC}"
  echo ""
fi

# Step 3: Check npm login
echo -e "${BLUE}🔐 Step 3: Checking npm authentication...${NC}"
if npm whoami &> /dev/null; then
  NPM_USER=$(npm whoami)
  echo -e "${GREEN}✓ Logged in as: $NPM_USER${NC}"
else
  echo -e "${RED}✗ Not logged in to npm. Please run 'npm login' first.${NC}"
  exit 1
fi
echo ""

# Step 4: Publish packages
echo -e "${BLUE}🚀 Step 4: Publishing packages...${NC}"
echo ""

PUBLISHED=0
FAILED=0
SKIPPED=0

for pkg in "${PACKAGES[@]}"; do
  PKG_DIR="$PACKAGES_DIR/$pkg"
  PKG_NAME="@fyit/$pkg"

  if [ ! -d "$PKG_DIR" ]; then
    echo -e "${YELLOW}⚠️  $PKG_NAME - Directory not found, skipping${NC}"
    ((SKIPPED++))
    continue
  fi

  cd "$PKG_DIR"

  # Get version from package.json
  VERSION=$(node -p "require('./package.json').version")

  # Check if already published
  if npm view "$PKG_NAME@$VERSION" version &> /dev/null; then
    echo -e "${YELLOW}⏭️  $PKG_NAME@$VERSION - Already published, skipping${NC}"
    ((SKIPPED++))
    continue
  fi

  echo -e "${BLUE}Publishing $PKG_NAME@$VERSION...${NC}"

  if [ "$DRY_RUN" = true ]; then
    echo "  Would run: pnpm publish --access public --no-git-checks"
    ((PUBLISHED++))
  else
    if pnpm publish --access public --no-git-checks; then
      echo -e "${GREEN}✓ Published $PKG_NAME@$VERSION${NC}"
      ((PUBLISHED++))
    else
      echo -e "${RED}✗ Failed to publish $PKG_NAME${NC}"
      ((FAILED++))
      # Continue with other packages instead of exiting
    fi
  fi

  echo ""
done

# Summary
echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}  Summary${NC}"
echo -e "${BLUE}========================================${NC}"
echo -e "${GREEN}Published: $PUBLISHED${NC}"
echo -e "${YELLOW}Skipped:   $SKIPPED${NC}"
echo -e "${RED}Failed:    $FAILED${NC}"
echo ""

if [ "$DRY_RUN" = true ]; then
  echo -e "${YELLOW}This was a dry run. Run without --dry-run to actually publish.${NC}"
fi

if [ $FAILED -gt 0 ]; then
  echo -e "${RED}Some packages failed to publish. Check the output above.${NC}"
  exit 1
fi

echo -e "${GREEN}🎉 Done!${NC}"