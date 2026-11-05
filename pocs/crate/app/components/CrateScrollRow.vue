<template>
  <!-- One sideways-scrolling row; the right edge fades so overflow reads as "more", not "cut off". -->
  <div data-no-swipe class="flex min-w-0 items-center gap-1.5 overflow-x-auto whitespace-nowrap [mask-image:linear-gradient(to_right,black_85%,transparent)] [scrollbar-width:none] pe-6">
    <slot />
  </div>
</template>
