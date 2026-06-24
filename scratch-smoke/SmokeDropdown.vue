<!--
  THROWAWAY smoke test for the frontend-review CI gate (epic #834).
  Deliberately uses the v3 component name <UDropdown> (v4 is <UDropdownMenu>)
  to confirm the gate fires 🔴 with a sticky comment. Delete after the smoke.
-->
<script setup lang="ts">
const items = [[{ label: 'Profile' }, { label: 'Settings' }]]
</script>

<template>
  <UDropdown :items="items">
    <UButton label="Open" />
  </UDropdown>
</template>
