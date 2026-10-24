<template>
  <section class="friday-page">
    <header class="page-header">
      <div class="heading-group"><h1>{{ title }}</h1><p v-if="description">{{ description }}</p></div>
      <div class="header-actions"><slot name="actions" /></div>
    </header>
    <slot />
  </section>
</template>

<script setup>
defineProps({ title: String, description: String })
</script>

<style scoped>
/* 官方 AutomationView 页面的骨架、标题、间距与断点。 */
.friday-page { position:relative; min-height:100%; padding:56px 48px 48px; background:var(--bg-primary); color:var(--text-primary); }
.page-header { display:grid; grid-template-columns:minmax(0,1fr) auto; align-items:flex-start; gap:14px; }
.heading-group { min-width:0; }
.heading-group h1 { font-size:22px; line-height:1.35; font-weight:650; letter-spacing:0; }
.heading-group p { margin-top:5px; color:var(--text-secondary); font-size:13px; line-height:1.5; }
.header-actions { display:flex; gap:8px; flex-shrink:0; }
@media(max-width:860px) { .friday-page { padding:44px 32px 40px; } }
@media(max-width:560px) { .friday-page { padding:36px 20px; } .page-header { grid-template-columns:1fr; } .heading-group h1 { font-size:21px; } .header-actions { gap:6px; } }
</style>
