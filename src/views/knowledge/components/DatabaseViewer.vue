<template>
  <div class="database-viewer">
    <div v-if="loading" class="database-state">正在读取数据库…</div>
    <div v-else-if="error" class="database-state database-error">{{ error }}</div>
    <template v-else-if="tables.length">
      <div class="database-tabs" role="tablist">
        <button v-for="(table, index) in tables" :key="table.name" type="button" :class="{ active: index === activeIndex }" @click="activeIndex = index">{{ table.name }} <span>{{ table.rows.length }}</span></button>
      </div>
      <div class="database-table-wrap">
        <table>
          <thead><tr><th v-for="column in activeTable.columns" :key="column.name">{{ column.name }}<small v-if="column.type">{{ column.type }}</small></th></tr></thead>
          <tbody><tr v-for="(row, rowIndex) in activeTable.rows" :key="rowIndex"><td v-for="column in activeTable.columns" :key="column.name">{{ displayValue(row[column.name]) }}</td></tr></tbody>
        </table>
        <div v-if="!activeTable.rows.length" class="database-empty">此表暂无数据</div>
      </div>
    </template>
    <div v-else class="database-state">数据库中没有可预览的用户表。</div>
  </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
const props = defineProps({ filePath: { type: String, required: true } })
const loading = ref(false); const error = ref(''); const tables = ref([]); const activeIndex = ref(0)
const activeTable = computed(() => tables.value[activeIndex.value] || { columns: [], rows: [] })
const displayValue = (value) => value === null || value === undefined ? 'NULL' : typeof value === 'object' ? JSON.stringify(value) : String(value)
async function load() {
  loading.value = true; error.value = ''; tables.value = []; activeIndex.value = 0
  try {
    const result = await window.electronAPI?.invoke('kb-read-sqlite', { filePath: props.filePath })
    if (!result?.success) throw new Error(result?.error || '数据库读取失败')
    tables.value = Array.isArray(result.tables) ? result.tables : []
  } catch (cause) { error.value = cause?.message || '数据库读取失败' } finally { loading.value = false }
}
watch(() => props.filePath, load, { immediate: true })
</script>

<style scoped>
.database-viewer { height: 100%; min-height: 240px; display: flex; flex-direction: column; background: var(--bg-primary, #fff); color: var(--text-primary, #1f2937); }
.database-state { flex: 1; display: grid; place-items: center; padding: 32px; color: var(--text-tertiary, #64748b); text-align: center; }
.database-error { color: #b91c1c; }
.database-tabs { display: flex; gap: 4px; overflow-x: auto; padding: 8px 12px; border-bottom: 1px solid var(--border-color, #e2e8f0); background: var(--bg-secondary, #f8fafc); }
.database-tabs button { flex: 0 0 auto; padding: 6px 10px; border: 1px solid transparent; border-radius: 5px; background: transparent; color: var(--text-secondary, #475569); cursor: pointer; font-size: 12px; }
.database-tabs button.active { border-color: var(--accent-color, #2563eb); background: var(--bg-primary, #fff); color: var(--accent-color, #2563eb); }
.database-tabs span { margin-left: 4px; color: var(--text-tertiary, #94a3b8); font-size: 10px; }
.database-table-wrap { flex: 1; overflow: auto; padding: 12px; }
.database-table-wrap table { min-width: 100%; border-collapse: collapse; font-size: 12px; }
.database-table-wrap th, .database-table-wrap td { max-width: 360px; padding: 7px 9px; border: 1px solid var(--border-color, #e2e8f0); text-align: left; vertical-align: top; white-space: pre-wrap; word-break: break-word; }
.database-table-wrap th { position: sticky; top: 0; background: var(--bg-secondary, #f8fafc); font-weight: 600; }
.database-table-wrap th small { display: block; margin-top: 2px; color: var(--text-tertiary, #94a3b8); font-weight: 400; }
.database-empty { padding: 24px; color: var(--text-tertiary, #64748b); text-align: center; }
</style>
