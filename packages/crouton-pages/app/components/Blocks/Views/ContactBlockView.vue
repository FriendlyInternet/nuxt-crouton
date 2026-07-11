<script setup lang="ts">
/**
 * Contact Block Editor View
 */
import { computed, ref } from 'vue'
import { NodeViewWrapper } from '@tiptap/vue-3'
import type { ContactBlockAttrs } from '../../../types/blocks'

const props = defineProps<{
  node: { attrs: ContactBlockAttrs }
  selected: boolean
  updateAttributes: (attrs: Partial<ContactBlockAttrs>) => void
  deleteNode: () => void
  getPos: () => number
}>()

const { t } = useT()
const attrs = computed(() => props.node.attrs)
const innerRef = ref<HTMLElement | null>(null)

const displayName = computed(() => {
  const { firstName, lastName } = attrs.value
  if (firstName || lastName) return [firstName, lastName].filter(Boolean).join(' ')
  return null
})

const isHorizontal = computed(() => attrs.value.layout === 'horizontal')
const showAvatar = computed(() => attrs.value.showAvatar !== false)

// Resolve team member name when in member mode
const { members, loadMembers } = useTeam()
const memberLoaded = ref(false)

onMounted(async () => {
  if (attrs.value.mode === 'member' && attrs.value.memberId) {
    await loadMembers()
    memberLoaded.value = true
  }
})

watch(() => attrs.value.mode, async (mode) => {
  if (mode === 'member' && !memberLoaded.value) {
    await loadMembers()
    memberLoaded.value = true
  }
})

const resolvedMember = computed(() => {
  if (attrs.value.mode !== 'member' || !attrs.value.memberId) return null
  const member = members.value.find(m => m.userId === attrs.value.memberId)
  if (member && 'user' in member && member.user) {
    return {
      name: member.user.name || member.user.email,
      email: member.user.email,
      image: member.user.image
    }
  }
  return null
})

function findEditorId(): string | undefined {
  let el: HTMLElement | null = innerRef.value
  while (el) {
    if (el.classList?.contains('crouton-editor-blocks') && el.dataset?.editorId) {
      return el.dataset.editorId
    }
    el = el.parentElement
  }
  return undefined
}

function handleOpenPanel() {
  const editorId = findEditorId()
  const event = new CustomEvent('block-edit-request', {
    bubbles: true,
    detail: { node: props.node, pos: props.getPos(), editorId }
  })
  document.dispatchEvent(event)
}
</script>

<template>
  <NodeViewWrapper
    class="block-wrapper my-1 cursor-pointer"
    :class="{ 'border-l-2 border-l-primary/50': selected }"
    data-type="contact-block"
    @dblclick="handleOpenPanel"
  >
    <div ref="innerRef" class="relative group rounded border border-transparent hover:border-gray-200/50 dark:hover:border-gray-700/50 transition-colors">
      <div class="p-3">
        <!-- Block Header -->
        <div class="flex items-center justify-between mb-2">
          <span class="inline-flex items-center gap-1 text-[10px] font-medium text-gray-400 uppercase tracking-wider">
            <UIcon name="i-lucide-contact" class="size-3" />
            Contact
            <span v-if="isHorizontal" class="text-gray-300 ml-1">(Horizontal)</span>
          </span>
          <div class="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-0.5">
            <UButton
              color="neutral"
              variant="ghost"
              size="xs"
              square
              icon="i-lucide-pencil"
              class="text-dimmed hover:text-primary"
              :aria-label="t('pages.blocks.editBlock')"
              :title="t('pages.blocks.editBlock')"
              @click.stop="handleOpenPanel"
            />
            <UButton
              color="neutral"
              variant="ghost"
              size="xs"
              square
              icon="i-lucide-trash-2"
              class="text-dimmed hover:text-error"
              :aria-label="t('pages.blocks.deleteBlock')"
              :title="t('pages.blocks.deleteBlock')"
              @click.stop="deleteNode"
            />
          </div>
        </div>

        <!-- Preview Content -->
        <div class="flex items-center gap-3">
          <!-- Team Member Mode -->
          <template v-if="attrs.mode === 'member' && attrs.memberId">
            <UAvatar
              v-if="showAvatar && (resolvedMember?.image || resolvedMember?.name)"
              :src="resolvedMember?.image || undefined"
              :text="(resolvedMember?.name || '?').slice(0, 2).toUpperCase()"
              size="sm"
            />
            <div class="min-w-0">
              <p v-if="resolvedMember?.name" class="text-sm font-medium text-gray-900 dark:text-white truncate">
                {{ resolvedMember.name }}
              </p>
              <p v-if="resolvedMember?.email" class="text-xs text-gray-500 truncate">
                {{ resolvedMember.email }}
              </p>
              <p v-if="!resolvedMember" class="text-xs text-gray-400 italic">
                Loading member...
              </p>
            </div>
          </template>

          <!-- Manual Mode -->
          <template v-else-if="displayName || attrs.email">
            <UAvatar
              v-if="showAvatar && (attrs.avatar || displayName)"
              :src="attrs.avatar"
              :text="displayName || '?'"
              size="sm"
            />
            <div class="min-w-0">
              <p v-if="displayName" class="text-sm font-medium text-gray-900 dark:text-white truncate">
                {{ displayName }}
              </p>
              <p v-if="attrs.email" class="text-xs text-gray-500 truncate">
                {{ attrs.email }}
              </p>
            </div>
          </template>

          <!-- Empty State -->
          <span v-else class="text-xs text-gray-400 italic">
            No contact set
          </span>
        </div>
      </div>
    </div>
  </NodeViewWrapper>
</template>
