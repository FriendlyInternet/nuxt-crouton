<!--
  Known-bad fixture for the frontend-review gate smoke (#1035, formalizing #847).
  Deliberately uses the v3 component name <UDropdown> (v4 is <UDropdownMenu>) so
  the gate's checklist must flag it 🔴 critical (v3-name). Committed on purpose —
  do not "fix" this file. See .claude/gate-fixtures/README.md.
-->
<script setup lang="ts">
const items = [[{ label: 'Profile' }, { label: 'Settings' }]]
</script>

<template>
  <UDropdown :items="items">
    <UButton label="Open" />
  </UDropdown>
</template>
