<script setup lang="ts">
/** @route /admin/[team]/sales/devices */
definePageMeta({ middleware: ['auth'] })
</script>

<template>
  <div class="p-4 sm:p-6">
    <SalesSyncDevices />
  </div>
</template>
