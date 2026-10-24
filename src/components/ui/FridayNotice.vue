<template>
  <div :class="['friday-notice', { error }]" :role="error ? 'alert' : 'status'"><CircleAlert v-if="error" :size="16" /><Info v-else :size="16" /><div class="notice-message"><slot /></div><slot name="action" /></div>
</template>
<script setup>
import { CircleAlert, Info } from 'lucide-vue-next'
defineProps({ error: Boolean })
</script>
<style scoped>
/* 官方自动化 local-task-notice 的提示密度与主题色。 */
.friday-notice{min-height:38px;padding:8px 10px;border:1px solid color-mix(in srgb,var(--accent-color) 24%,transparent);border-radius:8px;display:flex;align-items:center;gap:8px;background:var(--accent-light);font-size:13px;line-height:1.5}.friday-notice>svg{flex-shrink:0;color:var(--accent-color)}.notice-message{flex:1;min-width:0}.error{border-color:rgba(217,84,77,.24);background:rgba(217,84,77,.08)}.error>svg{color:#d9544d}
</style>
