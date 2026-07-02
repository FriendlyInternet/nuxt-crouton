<!--
  Known-bad fixture for the a11y gate smoke (#1035). An icon-only interactive
  control with no accessible name, no keyboard handler, and no semantic role —
  a critical/serious a11y violation (unlabeled control + non-interactive
  element used as a button). Committed on purpose — do not "fix" this file.
  See .claude/gate-fixtures/README.md.
-->
<script setup lang="ts">
function onDelete() {
  // no-op: this fixture only needs to exist for the gate to scan it
}
</script>

<template>
  <div @click="onDelete">
    <UIcon name="i-lucide-trash-2" />
  </div>
</template>
