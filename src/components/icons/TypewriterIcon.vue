<template>
  <img :src="iconUrl" :width="size" :height="size" :alt="alt" class="typewriter-icon" draggable="false" />
</template>

<script setup>
defineProps({
  size: { type: [Number, String], default: 22 },
  alt: { type: String, default: 'Typewriter' }
})

const iconUrl = new URL('../../features/typewriter/nocturne-core/icon.svg', import.meta.url).href
</script>

<style scoped>
.typewriter-icon { display: block; object-fit: contain; filter: saturate(.78) contrast(.92); }
</style>
