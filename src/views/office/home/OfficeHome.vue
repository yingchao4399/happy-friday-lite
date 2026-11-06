<template>
  <div class="office-home">
    <HomeHero />
    <QuickCards :editor-types="editorTypes" @new="type => $emit('new-doc', type)" @open-local="$emit('open-local')" />
    <RecentsSection
      v-model:filter="filter"
      :entries="visibleEntries"
      :editor-types="editorTypes"
      @open="entry => $emit('open-recent', entry)"
      @toggle-star="toggleStar"
      @remove="removeRecent"
      @delete="deleteRecent"
      @reveal="reveal"
      @rename="renameRecent"
    />
  </div>
</template>

<script setup>
import { computed, onMounted } from 'vue';
import HomeHero from './HomeHero.vue';
import QuickCards from './QuickCards.vue';
import RecentsSection from './RecentsSection.vue';
import { useOfficeHome } from './useOfficeHome';

defineEmits(['new-doc', 'open-local', 'open-recent']);
const props = defineProps({ editorTypes: { type: Array, default: () => ['docs', 'sheets', 'slides', 'pdf'] } });

const {
  filter,
  filteredEntries,
  loadRecents,
  toggleStar,
  removeRecent,
  deleteRecent,
  reveal,
  renameRecent,
} = useOfficeHome();
const visibleEntries = computed(() => filteredEntries.value.filter(entry => props.editorTypes.includes(entry.type)));

onMounted(loadRecents);

defineExpose({ refresh: loadRecents });
</script>

<style scoped lang="scss">
// 上游 home.css 的设计 token → 映射到本产品的主题变量（深浅色跟随应用主题）
.office-home {
  --of-surface: var(--bg-primary, #ffffff);
  --of-surface-subtle: var(--bg-tertiary, #eceff3);
  --of-bg-content: var(--bg-primary, #ffffff);
  --of-bg-hover: var(--bg-tertiary, #eceff3);
  --of-bg-hover-subtle: var(--bg-tertiary, #eceff3);
  --of-checkbox-bg: var(--bg-tertiary, #ececec);
  --of-border: var(--border-color, #e5e7eb);
  --of-border-subtle: var(--border-color, #f0f0f0);
  --of-border-hover: var(--border-color, #d1d5db);
  --of-text-primary: var(--text-primary, #1f2937);
  --of-text-secondary: var(--text-secondary, #6b7280);
  --of-text-tertiary: var(--text-secondary, #9ca3af);
  --of-text-muted: var(--text-secondary, #9ca3af);
  --of-icon-muted: var(--text-secondary, #9ca3af);
  --of-accent: #0f7fff;
  --of-accent-soft: var(--bg-tertiary, #eaf0fd);
  --of-shadow-pill: 0 1px 2px rgb(0 0 0 / 8%);

  flex: 1;
  min-width: 0;
  height: 100%;
  padding: 28px 36px 40px;
  overflow-y: auto;
  background: var(--of-bg-content);
}
</style>
