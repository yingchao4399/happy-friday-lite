<template>
  <button class="back-btn" type="button" :aria-label="t('note.back')" @click="goBack">
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>
  </button>
</template>
<script setup>
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
const router = useRouter()
const { t } = useI18n()
const props = defineProps({ onBack: { type: Function, default: null } })
const goBack = () => props.onBack ? props.onBack() : router.push('/settings')
</script>
<style scoped>
.back-btn { position: absolute; top: 12px; left: 16px; background: none; border: none; cursor: pointer; padding: 6px; display: flex; align-items: center; justify-content: center; color: var(--text-primary); transition: all 0.15s; border-radius: 6px; }
.back-btn:hover { background-color: var(--bg-hover); }
.back-btn svg { display: block; }
</style>
