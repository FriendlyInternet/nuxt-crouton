<template>
  <!-- No visible label — the select's placeholder/icon carry the meaning, and
       the row lines up with the category-tabs row beside it. -->
  <div class="p-1 -m-1 rounded-lg" :class="highlight ? 'border border-warning bg-warning/5' : ''">
    <!-- Dropdown with search and create — clients are always the reusable
         kind; there is no free-text mode. Typing an unknown name surfaces a
         "create" row (create-item): Enter or a click adds the client inline,
         no modal needed. -->
    <USelectMenu
      v-model="selectedValue"
      :items="allClients"
      value-key="id"
      label-key="title"
      :placeholder="t('sales.client.selectOrCreate')"
      :aria-label="t('sales.client.label')"
      icon="i-lucide-user"
      size="lg"
      class="w-full"
      :loading="creating"
      create-item
      searchable
      @create="createClientFromTerm"
    >
      <template #default="{ modelValue }">
        <span v-if="modelValue" class="truncate">
          {{ getClientLabel(modelValue as string) }}
        </span>
        <span v-else class="text-dimmed truncate">
          {{ t('sales.client.selectOrCreate') }}
        </span>
      </template>

      <template #create-item-label="{ item }">
        {{ t('sales.client.createNamed', { params: { name: item }, fallback: `Add "${item}"` }) }}
      </template>

      <template #content-top>
        <div class="p-1">
          <UButton
            color="neutral"
            icon="i-lucide-plus"
            variant="soft"
            block
            @click="openCreateModal"
          >
            {{ t('sales.client.createNew', 'Create new client') }}
          </UButton>
        </div>
      </template>
    </USelectMenu>

    <!-- Create client modal -->
    <UModal
      v-model:open="createModalOpen"
      :title="t('sales.client.createNew', 'Create new client')"
      :ui="{ footer: 'justify-end' }"
    >
      <template #body>
        <UFormField :label="t('sales.client.nameLabel', 'Client name')" required>
          <UInput
            v-model="newClientName"
            :placeholder="t('sales.client.namePlaceholder', 'Enter client name')"
            size="xl"
            class="w-full"
            @keyup.enter="createClient"
          />
        </UFormField>
      </template>

      <template #footer="{ close }">
        <UButton
          color="neutral"
          variant="outline"
          @click="close"
        >
          {{ t('common.cancel', 'Cancel') }}
        </UButton>
        <UButton
          color="primary"
          :loading="creating"
          :disabled="!newClientName.trim()"
          @click="createClient"
        >
          {{ t('common.create', 'Create') }}
        </UButton>
      </template>
    </UModal>
  </div>
</template>

<script setup lang="ts">
import type { SalesClient } from '../../types'

const { t } = useT()

const props = defineProps<{
  clients: SalesClient[]
  highlight?: boolean
  clientId?: string | null
  /** Event ID for helper-scoped client creation (volunteer/POS flows) */
  eventId?: string
}>()

const emit = defineEmits<{
  'update:clientId': [clientId: string | null]
  'update:clientName': [clientName: string]
  'client-created': [client: SalesClient]
}>()

const selectedValue = ref<string>('')
const creating = ref(false)
const createModalOpen = ref(false)
const newClientName = ref('')

// Track newly created clients (with their IDs) — a local bridge until the
// next order-data refetch returns them from the server.
const createdClients = ref<SalesClient[]>([])

// Combine existing clients with any newly created items
const allClients = computed(() => [...props.clients, ...createdClients.value])

// A fresh props.clients comes from a refetched order-data payload: prune the
// local copies the server now confirms, so later refetches fully control the
// list — otherwise a client created here would linger after its tab is
// settled (end-receipt deactivates it and drops it from order-data).
watch(() => props.clients, (list) => {
  if (createdClients.value.length === 0) return
  const serverIds = new Set(list.map(c => c.id))
  createdClients.value = createdClients.value.filter(c => !serverIds.has(c.id))
})

// When the selected client disappears (tab settled), clear the selection so
// checkout can't reference an inactive client.
watch(allClients, (list) => {
  if (selectedValue.value && !list.some(c => c.id === selectedValue.value)) {
    selectedValue.value = ''
    emit('update:clientId', null)
    emit('update:clientName', '')
  }
})

// Client label helper
const clientLabelsMap = computed(() => {
  const map = new Map<string, string>()
  for (const client of allClients.value) {
    map.set(client.id, client.title)
  }
  return map
})

const getClientLabel = (id: string): string => {
  return clientLabelsMap.value.get(id) || id
}

const { token } = useHelperAuth()
const nuxtApp = useNuxtApp()

const openCreateModal = () => {
  newClientName.value = ''
  createModalOpen.value = true
}

// Inline create from the select's create-item row (type a new name → Enter/+).
async function createClientFromTerm(term: string) {
  const title = term.trim()
  if (!title || creating.value) return
  // Exact-match guard: create-item hides on exact matches, but Enter can still
  // race a slow list refresh — select the existing client instead of duping.
  const existing = allClients.value.find(c => c.title.trim().toLowerCase() === title.toLowerCase())
  if (existing) {
    selectedValue.value = existing.id
    return
  }
  await createClientWithTitle(title)
}

// Handle creating a new client (modal path)
async function createClient() {
  await createClientWithTitle(newClientName.value.trim())
}

async function createClientWithTitle(title: string) {
  if (!title) return

  creating.value = true
  try {
    let newClient: { id: string; title: string } | null = null

    if (props.eventId && token.value) {
      // Volunteer/POS flow: use helper-scoped endpoint
      newClient = await $fetch<{ id: string; title: string }>(`/api/crouton-sales/events/${props.eventId}/clients`, {
        method: 'POST',
        body: { title },
        headers: { 'x-scoped-token': token.value }
      })
    }

    if (newClient?.id) {
      const client = { id: newClient.id, title: newClient.title }
      createdClients.value.push(client)
      selectedValue.value = newClient.id
      emit('update:clientId', newClient.id)
      emit('update:clientName', newClient.title)
      emit('client-created', client)
      createModalOpen.value = false
      newClientName.value = ''
      // The create POST bypasses useCollectionMutation — emit the hook so
      // Pos/Panel.vue refetches order-data, which confirms the new client
      // server-side (and lets the prune watch above drop the local copy).
      await nuxtApp.hooks.callHook('crouton:mutation', {
        operation: 'create',
        collection: 'salesClients',
        itemId: client.id,
        data: client,
        result: null,
        correlationId: `pos-client-create-${client.id}`,
        timestamp: Date.now()
      })
    }
  }
  catch (error) {
    console.error('Failed to create client:', error)
  }
  finally {
    creating.value = false
  }
}

// Emit selection changes
watch(selectedValue, (value) => {
  if (!value) return

  const client = allClients.value.find(c => c.id === value)
  if (client) {
    emit('update:clientId', client.id)
    emit('update:clientName', client.title)
  }
})

// Sync with external props (for clearing/resetting)
watch(() => props.clientId, (newId) => {
  selectedValue.value = newId || ''
})
</script>
