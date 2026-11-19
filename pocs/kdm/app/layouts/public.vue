<script setup lang="ts">
/**
 * Kasper's public look (#4153) — overrides crouton-pages' `public` layout
 * (packages/crouton-pages/app/layouts/public.vue; an app layout of the same
 * name wins over a layer's). The package page route
 * (`/[team]/[locale]/[...slug]`) still does all the routing, fetching and
 * editing; this file only changes what is drawn around it.
 *
 * Kept from the package layout (the contract the page route relies on):
 * - the `pageLayout` state (default / full-height / full-screen);
 * - the `pageChrome` state (per-page hideNav / hideAuthControls);
 * - the nav pill for signed-in users — it carries the "edit this page"
 *   pencil the page route registers with `registerNavAction`;
 * - the editing drawer (`pageEditing` / `editingPageId` state, tree +
 *   inline editor), unchanged;
 * - the post-hydration class fix-up (applyLayoutClasses).
 *
 * Dropped for signed-out visitors only: the nav pill (menu, logo, sign-in
 * control) and the footer. Source look: pmcp/kdm `app/layouts/default.vue`
 * + `app/pages/[...slug].vue` — one centred max-w-4xl column, monospace,
 * prose body. The page title is the first `h1` of the body (styled in
 * main.css), never a second heading here.
 */
import { useMediaQuery } from '@vueuse/core'

const { t } = useT()
const pageLayout = useState<'default' | 'full-height' | 'full-screen'>('pageLayout', () => 'default')

// Signed-out visitors see the bare page; the team's editors keep the chrome.
const { isAuthenticated } = useSession()

const { navigation } = useNavigation()
const isSinglePage = computed(() => !navigation.value || navigation.value.length <= 1)
const pageChrome = useState<{ hideNav: boolean, hideAuthControls: boolean }>('pageChrome', () => ({ hideNav: false, hideAuthControls: false }))
const navPillHidden = computed(() => isSinglePage.value || pageChrome.value.hideNav)

// `<title>` = the page title alone, without core's "| <team name>" suffix.
useHead({ titleTemplate: '%s' })

// Inline editing state (shared with the page route via useState)
const isEditing = useState<boolean>('pageEditing', () => false)
const editingPageId = useState<string | null>('editingPageId', () => null)

const isDesktop = useMediaQuery('(min-width: 1024px)')

function onTreeSelect(page: any) {
  editingPageId.value = page?.id ?? null
  isCreating.value = false
}

const isCreating = ref(false)
const createParentId = ref<string | null>(null)

const { setGhost, clearGhost } = useGhostPage()

function onTreeCreate(parentId?: string | null) {
  // Guard against PointerEvent being passed from @click handlers
  const resolvedParentId = (parentId && typeof parentId === 'string') ? parentId : null
  editingPageId.value = null
  createParentId.value = resolvedParentId
  isCreating.value = true
  setGhost(resolvedParentId)
}

function handleEditorSave(page: any) {
  isCreating.value = false
  clearGhost()
  if (page?.id) {
    editingPageId.value = page.id
  }
}

function handleEditorClose() {
  isEditing.value = false
  editingPageId.value = null
  isCreating.value = false
  clearGhost()
}

function handleEditorCancel() {
  editingPageId.value = null
  isCreating.value = false
  clearGhost()
}

function handleEditorDelete() {
  editingPageId.value = null
  isCreating.value = false
}

const drawerOpen = computed({
  get: () => isEditing.value,
  set: (val: boolean) => {
    if (!val) {
      handleEditorClose()
    }
  }
})

// Top padding: clear the floating nav pill only when a signed-in user sees
// it; otherwise the column starts like the source site (mt-12 on the prose).
const topPadding = computed(() => {
  if (!isAuthenticated.value) return ''
  return navPillHidden.value ? 'pt-4 sm:pt-6' : 'pt-20 sm:pt-24'
})

// The page route sets `pageLayout` during SSR after this layout rendered, so
// re-apply the classes after hydration and on navigation (same fix as the
// package layout).
const containerRef = ref<HTMLElement>()
const mainRef = ref<HTMLElement>()
function applyLayoutClasses() {
  if (!containerRef.value || !mainRef.value) return
  containerRef.value.className = `bg-default text-default ${containerClasses.value}`
  mainRef.value.className = mainClasses.value
}
onMounted(() => nextTick(applyLayoutClasses))
watch([pageLayout, navPillHidden, isAuthenticated], () => nextTick(applyLayoutClasses))

const containerClasses = computed(() =>
  pageLayout.value === 'full-height' ? 'h-screen flex flex-col overflow-hidden' : 'min-h-screen'
)

const mainClasses = computed(() => {
  const pt = topPadding.value
  switch (pageLayout.value) {
    case 'full-height':
      return `flex-1 overflow-hidden ${pt} px-4 sm:px-6 lg:px-8 max-w-4xl mx-auto w-full font-mono`
    case 'full-screen':
      return 'p-3 sm:p-4 font-mono'
    default:
      return `max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 ${pt} pb-8 font-mono`
  }
})
</script>

<template>
  <div ref="containerRef" class="bg-default text-default" :class="containerClasses">
    <!-- Nav pill (menu, edit pencil, account) — the team's editors only -->
    <CroutonPagesNav v-if="isAuthenticated" />

    <main ref="mainRef" :class="mainClasses">
      <div class="site-prose prose mx-auto mt-12">
        <slot />
      </div>
    </main>

    <CroutonPagesFooter v-if="isAuthenticated" />

    <!-- Editing drawer — same as the package layout -->
    <UDrawer
      v-model:open="drawerOpen"
      should-scale-background
      :dismissible="false"
      :handle="false"
      inset
      :ui="{ content: 'h-[85vh]' }"
    >
      <template #content>
        <div class="flex h-full">
          <div v-if="isDesktop" class="w-72 shrink-0 overflow-y-auto border-r border-default">
            <CroutonPagesWorkspaceSidebar
              :model-value="editingPageId"
              @update:model-value="editingPageId = $event"
              @select="onTreeSelect"
              @create="onTreeCreate"
            />
          </div>

          <div class="flex-1 min-w-0 overflow-y-auto">
            <CroutonPagesInlineEditor
              v-if="editingPageId || isCreating"
              :page-id="editingPageId"
              :default-parent-id="isCreating ? createParentId : null"
              @save="handleEditorSave"
              @cancel="handleEditorCancel"
              @delete="handleEditorDelete"
              @close="handleEditorClose"
            />
            <div v-else class="flex items-center justify-center h-full text-muted">
              <div class="text-center space-y-2">
                <UIcon name="i-lucide-file-text" class="size-8 mx-auto opacity-50" />
                <p class="text-sm">
                  {{ t('pages.workspace.selectPageToEdit') }}
                </p>
              </div>
            </div>
          </div>
        </div>
      </template>
    </UDrawer>
  </div>
</template>
