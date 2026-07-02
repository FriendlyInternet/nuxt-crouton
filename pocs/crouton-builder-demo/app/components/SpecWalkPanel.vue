<script setup lang="ts">
/**
 * SpecWalkPanel — the non-blocking bottom-sheet for the reconcile/verify walk (#1039).
 *
 * Opened by the "Spec walk" tool in the crouton-feedback glasses launcher (via the
 * shared `open` flag in useSpecWalk). NO overlay — the board stays fully interactive,
 * so you actually perform each test step, then mark ✅/⚠️/➕. Collapses by closing.
 * A light pointer-events:none outline tracks the current hooked element (rAF, so it
 * stays glued through Vue Flow pan/zoom); gesture-transient hooks show a hint instead.
 */
import { ref, reactive, computed, onMounted, onBeforeUnmount } from 'vue'
import { useSpecWalk } from '../composables/useSpecWalk'

const { open, idx, walk, verdicts, marked, current, setVerdict, setNote, go, exportText, stepsOf, selectorFor } = useSpecWalk()

const showExport = ref(false)
const copied = ref(false)
const hl = reactive({ show: false, x: 0, y: 0, w: 0, h: 0 })

async function copyExport() {
  try { await navigator.clipboard.writeText(exportText.value); copied.value = true; setTimeout(() => copied.value = false, 1500) } catch { /* ignore */ }
}

// Non-blocking outline that tracks the current hooked element (survives pan/zoom).
let raf = 0
function track() {
  const e = current.value
  const sel = e ? selectorFor(e.hook) : ''
  const el = sel && open.value && !showExport.value ? document.querySelector(sel) : null
  if (el) {
    const r = el.getBoundingClientRect()
    hl.show = r.width > 0 && r.height > 0
    hl.x = r.x; hl.y = r.y; hl.w = r.width; hl.h = r.height
  } else { hl.show = false }
  raf = requestAnimationFrame(track)
}
onMounted(() => { raf = requestAnimationFrame(track) })
onBeforeUnmount(() => cancelAnimationFrame(raf))

const verdictOf = computed(() => (current.value ? verdicts.value[current.value.id]?.verdict : undefined))
const noteOf = computed(() => (current.value ? verdicts.value[current.value.id]?.note || '' : ''))
</script>

<template>
  <!-- Non-blocking element outline (hooked entries with a live element only). -->
  <div
    v-if="open && hl.show"
    class="pointer-events-none fixed z-40 rounded-md ring-2 ring-primary ring-offset-2 ring-offset-transparent transition-all duration-150"
    :style="{ left: hl.x + 'px', top: hl.y + 'px', width: hl.w + 'px', height: hl.h + 'px' }"
  />

  <!-- Bottom-sheet panel — NO overlay, board stays interactive. -->
  <div
    v-if="open"
    class="fixed inset-x-0 bottom-0 z-50 max-h-[52dvh] overflow-y-auto rounded-t-2xl border-t border-default bg-elevated/95 shadow-2xl backdrop-blur"
  >
      <div class="mx-auto flex max-w-2xl flex-col gap-3 p-4">
        <!-- header -->
        <div class="flex items-center gap-2">
          <UIcon name="i-lucide-footprints" class="size-4 text-primary" />
          <span class="text-sm font-semibold">Spec walk</span>
          <span class="font-mono text-[11px] text-muted">{{ showExport ? 'export' : `${idx + 1} / ${walk.length}` }}</span>
          <span class="ms-1 rounded-full bg-primary/15 px-1.5 py-0.5 font-mono text-[10px] text-primary">{{ marked }}/{{ walk.length }}</span>
          <div class="ms-auto flex items-center gap-1">
            <UButton size="xs" color="neutral" variant="ghost" icon="i-lucide-download" :label="showExport ? 'Walk' : 'Export'" @click="showExport = !showExport" />
            <UButton size="xs" color="neutral" variant="ghost" icon="i-lucide-x" aria-label="Close" @click="open = false" />
          </div>
        </div>

        <div class="h-1.5 overflow-hidden rounded-full bg-default">
          <div class="h-full rounded-full bg-primary transition-all" :style="{ width: (marked / walk.length * 100) + '%' }" />
        </div>

        <!-- EXPORT -->
        <template v-if="showExport">
          <p class="text-xs text-muted">{{ marked }} of {{ walk.length }} marked. Copy this and paste it back to the agent — confirmed entries flip <code>proposed → settled</code>.</p>
          <UTextarea :model-value="exportText" :rows="10" readonly class="w-full font-mono text-[11px]" />
          <UButton size="sm" color="primary" :icon="copied ? 'i-lucide-check' : 'i-lucide-copy'" :label="copied ? 'Copied' : 'Copy JSON'" @click="copyExport" />
        </template>

        <!-- WALK -->
        <template v-else-if="current">
          <div class="flex items-center gap-2">
            <code class="text-xs text-primary">{{ current.id }}</code>
            <span v-if="current.hook" class="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] text-primary">🔖 {{ current.hook }}</span>
          </div>
          <p class="text-sm font-medium">{{ current.behaviour }}</p>
          <div class="rounded-lg bg-default/60 p-2.5 text-[13px]">
            <span class="text-[10px] uppercase tracking-wide text-muted">When</span> {{ current.when }}
            <span class="text-primary">→</span>
            <span class="text-[10px] uppercase tracking-wide text-muted">Expect</span> {{ current.expect }}
          </div>
          <ol class="list-decimal space-y-1 ps-5 text-[13px] text-muted">
            <li v-for="(s, i) in stepsOf(current)" :key="i">{{ s }}</li>
          </ol>
          <p v-if="current.hook && !hl.show" class="text-[12px] text-warning">
            🔖 <code>{{ current.hook }}</code> appears during the gesture — do the steps and it lights up.
          </p>

          <div class="flex flex-wrap gap-2">
            <UButton size="sm" :color="verdictOf === 'confirmed' ? 'success' : 'neutral'" :variant="verdictOf === 'confirmed' ? 'solid' : 'soft'" label="✅ Confirmed" class="flex-1" @click="setVerdict('confirmed')" />
            <UButton size="sm" :color="verdictOf === 'contradicted' ? 'warning' : 'neutral'" :variant="verdictOf === 'contradicted' ? 'solid' : 'soft'" label="⚠️ Contradicted" class="flex-1" @click="setVerdict('contradicted')" />
            <UButton size="sm" :color="verdictOf === 'undocumented' ? 'primary' : 'neutral'" :variant="verdictOf === 'undocumented' ? 'solid' : 'soft'" label="➕ Undocumented" class="flex-1" @click="setVerdict('undocumented')" />
          </div>
          <UTextarea :model-value="noteOf" :rows="2" placeholder="note / delta — what the POC actually does…" class="w-full text-[13px]" @update:model-value="setNote($event)" />

          <div class="flex items-center gap-2 pt-1">
            <UButton size="sm" color="neutral" variant="ghost" icon="i-lucide-arrow-left" label="Prev" :disabled="idx === 0" @click="go(-1)" />
            <span class="grow" />
            <UButton v-if="idx < walk.length - 1" size="sm" color="neutral" variant="soft" trailing-icon="i-lucide-arrow-right" label="Next" @click="go(1)" />
            <UButton v-else size="sm" color="primary" variant="soft" icon="i-lucide-download" label="Export" @click="showExport = true" />
          </div>
        </template>
      </div>
    </div>
</template>
