<script setup lang="ts">
/**
 * SpecWalkOverlay — the panel for the Spec-walk tool (#1038 WS1).
 *
 * Mounted once (via specwalk.client plugin) into the host app's context and
 * toggled by the shared `open` flag from useSpecWalk. A NON-blocking bottom
 * sheet (no backdrop — the app stays interactive so you actually perform each
 * step), one behaviour at a time with its how-to-test steps, ✅ works / ⚠️ issue
 * per entry, and an Export that emits `lgtm <id>` lines to paste back to the
 * agent (the C1 sign-off). A light outline tracks the current behaviour's DOM
 * hook through pan/zoom.
 *
 * Styling follows the PlanOverlay convention: standard Tailwind utilities +
 * Nuxt UI components + `data-crouton-ui`, with inline styles for the few
 * arbitrary values (a package component's `[..]` classes aren't in the app's
 * Tailwind content scan, so they'd emit no CSS).
 */
import { ref, reactive, computed, onMounted, onBeforeUnmount } from 'vue'
import { useSpecWalk } from '../composables/useSpecWalk'

const {
  open, idx, walk, verdicts, marked, current,
  setVerdict, setNote, go, exportText, stepsOf, selectorFor
} = useSpecWalk()

const showExport = ref(false)
const copied = ref(false)
const hl = reactive({ show: false, x: 0, y: 0, w: 0, h: 0 })

async function copyExport() {
  try {
    await navigator.clipboard.writeText(exportText.value)
    copied.value = true
    setTimeout(() => (copied.value = false), 1500)
  } catch { /* ignore */ }
}

// Track the current behaviour's hook element so it stays outlined through the
// app's own pan/zoom (rAF, not a MutationObserver — the transform changes every
// frame). Cheap: one getBoundingClientRect per frame while the panel is open.
let raf = 0
function track() {
  const e = current.value
  const sel = e ? selectorFor(e.hook) : ''
  const el = sel && open.value && !showExport.value ? document.querySelector(sel) : null
  if (el) {
    const r = el.getBoundingClientRect()
    hl.show = r.width > 0 && r.height > 0
    hl.x = r.x; hl.y = r.y; hl.w = r.width; hl.h = r.height
  } else {
    hl.show = false
  }
  raf = requestAnimationFrame(track)
}
onMounted(() => { raf = requestAnimationFrame(track) })
onBeforeUnmount(() => cancelAnimationFrame(raf))

const verdictOf = computed(() => (current.value ? verdicts.value[current.value.id]?.verdict : undefined))
const noteOf = computed(() => (current.value ? verdicts.value[current.value.id]?.note || '' : ''))
const pct = computed(() => (walk.length ? Math.round(marked.value / walk.length * 100) : 0))
</script>

<template>
  <div data-crouton-ui>
    <!-- non-blocking outline that tracks the current behaviour's hook (survives pan/zoom) -->
    <div
      v-if="open && hl.show"
      class="pointer-events-none fixed z-40 rounded-md transition-all duration-150"
      :style="{
        left: `${hl.x}px`, top: `${hl.y}px`, width: `${hl.w}px`, height: `${hl.h}px`,
        outline: '2px solid var(--ui-primary)', outlineOffset: '2px'
      }"
    />

    <div
      v-if="open"
      class="fixed inset-x-0 bottom-0 z-50 overflow-y-auto rounded-t-2xl border-t border-default bg-elevated shadow-2xl"
      style="max-height: 52dvh"
      data-handoff="spec-walk"
    >
      <div class="mx-auto flex max-w-2xl flex-col gap-3 p-4">
        <div class="flex items-center gap-2">
          <UIcon name="i-lucide-list-checks" class="size-4 text-primary" />
          <span class="text-sm font-semibold">Check &amp; sign off</span>
          <span class="font-mono text-xs text-muted">{{ showExport ? 'sign-off' : `${idx + 1} / ${walk.length}` }}</span>
          <UBadge color="primary" variant="soft" size="sm" class="ms-1">{{ marked }}/{{ walk.length }}</UBadge>
          <div class="ms-auto flex items-center gap-1">
            <UButton
              size="xs" color="neutral" variant="ghost" icon="i-lucide-clipboard-check"
              :label="showExport ? 'Walk' : 'Sign off'" @click="showExport = !showExport"
            />
            <UButton
              size="xs" color="neutral" variant="ghost" icon="i-lucide-x"
              aria-label="Close" @click="open = false"
            />
          </div>
        </div>

        <div class="h-1.5 overflow-hidden rounded-full bg-default">
          <div class="h-full rounded-full bg-primary transition-all" :style="{ width: `${pct}%` }" />
        </div>

        <!-- SIGN-OFF EXPORT -->
        <template v-if="showExport">
          <p class="text-xs text-muted">
            {{ marked }} of {{ walk.length }} marked. Copy this and paste it back to the agent — each
            <code>lgtm &lt;id&gt;</code> signs that behaviour off (C1).
          </p>
          <UTextarea :model-value="exportText" :rows="10" readonly class="w-full font-mono text-xs" />
          <UButton
            size="sm" color="primary" :icon="copied ? 'i-lucide-check' : 'i-lucide-copy'"
            :label="copied ? 'Copied' : 'Copy sign-off'" @click="copyExport"
          />
        </template>

        <!-- WALK -->
        <template v-else-if="current">
          <div class="flex flex-wrap items-center gap-2">
            <code class="text-xs text-primary">{{ current.id }}</code>
            <UBadge v-if="current.bucket" color="primary" variant="soft" size="sm">{{ current.bucket }}</UBadge>
            <UBadge v-if="current.hook" color="primary" variant="soft" size="sm">🔖 {{ current.hook }}</UBadge>
          </div>
          <p class="text-sm font-medium">{{ current.behaviour }}</p>
          <div v-if="current.expect" class="rounded-lg bg-default p-2.5 text-sm">
            <span class="text-xs uppercase tracking-wide text-muted">Expect </span>{{ current.expect }}
          </div>
          <ol class="list-decimal space-y-1 ps-5 text-sm text-muted">
            <li v-for="(s, i) in stepsOf(current)" :key="i">{{ s }}</li>
          </ol>
          <p v-if="current.hook && !hl.show" class="text-xs text-warning">
            🔖 <code>{{ current.hook }}</code> appears during the gesture — do the steps and it lights up.
          </p>

          <div class="flex flex-wrap gap-2">
            <UButton
              size="sm" :color="verdictOf === 'works' ? 'success' : 'neutral'"
              :variant="verdictOf === 'works' ? 'solid' : 'soft'" label="✅ Works"
              class="flex-1" @click="setVerdict('works')"
            />
            <UButton
              size="sm" :color="verdictOf === 'issue' ? 'warning' : 'neutral'"
              :variant="verdictOf === 'issue' ? 'solid' : 'soft'" label="⚠️ Issue"
              class="flex-1" @click="setVerdict('issue')"
            />
          </div>
          <UTextarea
            :model-value="noteOf" :rows="2" placeholder="note — what's wrong / what you'd change…"
            class="w-full text-sm" @update:model-value="setNote($event)"
          />

          <div class="flex items-center gap-2 pt-1">
            <UButton
              size="sm" color="neutral" variant="ghost" icon="i-lucide-arrow-left"
              label="Prev" :disabled="idx === 0" @click="go(-1)"
            />
            <span class="grow" />
            <UButton
              v-if="idx < walk.length - 1" size="sm" color="neutral" variant="soft"
              trailing-icon="i-lucide-arrow-right" label="Next" @click="go(1)"
            />
            <UButton
              v-else size="sm" color="primary" variant="soft"
              icon="i-lucide-clipboard-check" label="Sign off" @click="showExport = true"
            />
          </div>
        </template>
      </div>
    </div>
  </div>
</template>
