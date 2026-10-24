<template>
  <button :type="type" :class="['friday-button', variant, { compact, icon: iconOnly }]"><slot /></button>
</template>

<script setup>
// 沿用官方 AutomationView 的 create-button / icon-button 控件和反馈。
defineProps({
  type: { type: String, default: 'button' },
  variant: { type: String, default: 'secondary' },
  compact: Boolean,
  iconOnly: Boolean
})
</script>

<style scoped>
.friday-button { height:34px; padding:0 14px; border:0; border-radius:8px; display:inline-flex; align-items:center; justify-content:center; gap:6px; color:var(--text-primary); font:inherit; font-size:13px; font-weight:500; white-space:nowrap; cursor:pointer; transition:background-color .15s ease,transform .15s ease; }
.friday-button:active:not(:disabled) { transform:translateY(1px); }
.secondary { background:var(--bg-secondary); }
.secondary:hover:not(:disabled) { background:var(--bg-active); }
.primary { background:var(--text-primary); color:var(--bg-primary); }
.primary:hover:not(:disabled) { opacity:.88; }
.text { background:transparent; color:var(--text-secondary); }
.text:hover:not(:disabled) { background:var(--bg-hover); color:var(--text-primary); }
.danger { background:transparent; color:#d9544d; }
.danger:hover:not(:disabled) { background:var(--bg-hover); }
.compact { height:28px; padding:0 9px; font-size:12px; border-radius:6px; }
.icon { width:28px; height:28px; padding:0; border-radius:6px; }
.friday-button:disabled { opacity:.45; cursor:default; }
</style>
