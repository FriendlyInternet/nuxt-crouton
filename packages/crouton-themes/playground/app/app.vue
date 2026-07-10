<script setup lang="ts">
// crouton-themes playground (#1306) — the daily dev surface AND the theme
// gallery this epic (#1303) uses for ui-proposal sign-off. Pages:
//   /    the gallery — every themed component once, restyled by the switcher
//   /ko  the original ko-ui hardware showcase, resurrected (#1304)
</script>

<template>
  <div class="min-h-screen bg-[var(--ui-bg,white)] p-6 max-w-5xl mx-auto space-y-10">
    <header class="flex flex-wrap items-center justify-between gap-4">
      <div class="space-y-1">
        <h1 class="text-2xl font-semibold tracking-tight">
          crouton-themes playground
        </h1>
        <p class="text-sm text-neutral-500">
          Every current theme, one component set. Switch themes to compare —
          nothing here is hand-drawn per theme, it's the same markup restyled.
        </p>
        <nav class="flex gap-4 text-sm">
          <NuxtLink to="/" class="underline underline-offset-2">Gallery</NuxtLink>
          <NuxtLink to="/ko" class="underline underline-offset-2">KO hardware showcase</NuxtLink>
        </nav>
      </div>
      <ThemeSwitcher />
    </header>

    <NuxtPage />
  </div>
</template>
