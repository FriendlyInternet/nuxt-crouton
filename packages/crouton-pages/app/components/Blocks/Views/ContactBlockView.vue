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


</script>

<template>
  <NodeViewWrapper data-type="contact-block">
    <CroutonBlockFrame
      :node="node"
      :get-pos="getPos"
      :selected="selected"
      icon="i-lucide-contact"
      :label="t('pages.blockLibrary.contact.name')"
      @delete="deleteNode"
    >
      <template v-if="isHorizontal" #meta>
        <span class="text-[10px] text-gray-300">({{ t('pages.blockLibrary.contact.fields.layout.options.horizontal') }})</span>
      </template>

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
                {{ t('pages.blockViews.loadingMember') }}
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
            {{ t('pages.blockViews.noContact') }}
          </span>
        </div>
    </CroutonBlockFrame>
  </NodeViewWrapper>
</template>
