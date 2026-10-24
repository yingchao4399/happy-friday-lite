<template>
  <nav class="tabs" :aria-label="label"><button v-for="tab in tabs" :key="tab.key" type="button" :class="['tab-button', { active: modelValue === tab.key }]" :aria-pressed="modelValue === tab.key" @click="$emit('update:modelValue', tab.key)">{{ tab.label }}</button></nav>
</template>
<script setup>
defineProps({ modelValue: String, tabs: { type: Array, default: () => [] }, label: String })
defineEmits(['update:modelValue'])
</script>
<style scoped>
/* 官方 AutomationView.vue 的选项卡结构与样式。 */
.tabs{display:flex;gap:24px;margin-top:24px;overflow-x:auto}.tab-button{position:relative;height:38px;border:0;flex-shrink:0;background:transparent;color:var(--text-secondary);font:inherit;font-size:16px;font-weight:550;cursor:pointer}.tab-button:hover,.tab-button.active{color:var(--text-primary)}.tab-button.active::after{content:'';position:absolute;left:0;right:0;bottom:0;height:2px;border-radius:3px;background:var(--text-primary)}
@media(max-width:560px){.tabs{gap:20px}}
</style>
