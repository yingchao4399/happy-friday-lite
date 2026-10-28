<template>
  <div class="scoped-history" @keydown.esc="open = false">
    <button class="scoped-history-toggle" type="button" :title="title" @click="toggle">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="9"></circle><polyline points="12 7 12 12 15 14"></polyline>
      </svg>
      <span v-if="label">{{ label }}</span>
    </button>
    <div v-if="open" class="scoped-history-panel">
      <div class="scoped-history-heading"><span>{{ panelTitle }}</span><button type="button" @click="open = false">×</button></div>
      <div v-if="loading" class="scoped-history-empty">{{ t('friday.scopedHistory.loading') }}</div>
      <div v-else-if="!sessions.length" class="scoped-history-empty">{{ t('friday.scopedHistory.empty') }}</div>
      <button v-for="session in sessions" v-else :key="session.id" class="scoped-history-item" type="button" @click="select(session)">
        <span>{{ session.title || t('friday.scopedHistory.untitled') }}</span><small>{{ format(session.updatedAt) }}</small>
      </button>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { electronService } from '@/services/electron'

const props = defineProps({
  scope: { type: String, default: 'friday' },
  scopeKey: { type: String, default: '' },
  label: { type: String, default: '' },
  title: { type: String, default: '' }
})
const emit = defineEmits(['select'])
const { t } = useI18n()
const panelTitle = computed(() => props.title || t('friday.historyTitle'))
const open = ref(false)
const loading = ref(false)
const sessions = ref([])

async function toggle() {
  open.value = !open.value
  if (!open.value) return
  loading.value = true
  try { sessions.value = await electronService.invoke('get_sessions', { scope: props.scope, scopeKey: props.scopeKey || undefined }) || [] } finally { loading.value = false }
}
async function select(session) {
  open.value = false
  const messages = await electronService.invoke('get_session_messages', { sessionId: session.id, scope: props.scope, scopeKey: props.scopeKey || undefined })
  emit('select', { session, messages: messages || [] })
}
function format(value) {
  try { return new Date(value).toLocaleString(undefined, { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) } catch { return '' }
}
</script>

<style scoped>
.scoped-history { position: relative; display: inline-flex; }
.scoped-history-toggle { display: inline-flex; align-items: center; gap: 5px; border: 0; background: transparent; color: var(--text-secondary); cursor: pointer; padding: 6px 8px; border-radius: 8px; }
.scoped-history-toggle:hover { background: var(--bg-hover); color: var(--text-primary); }
.scoped-history-panel { position: absolute; top: calc(100% + 6px); right: 0; z-index: 10020; width: 260px; max-height: 320px; overflow: auto; padding: 8px; border: 1px solid var(--border-color); border-radius: 10px; background: var(--bg-primary); box-shadow: 0 8px 24px rgba(0,0,0,.16); }
.scoped-history-heading { display: flex; justify-content: space-between; align-items: center; padding: 4px 6px 8px; color: var(--text-primary); font-size: 13px; font-weight: 600; }
.scoped-history-heading button { border: 0; background: transparent; color: var(--text-secondary); cursor: pointer; font-size: 18px; }
.scoped-history-item { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; width: 100%; border: 0; background: transparent; color: var(--text-primary); cursor: pointer; padding: 8px; border-radius: 7px; text-align: left; }
.scoped-history-item:hover { background: var(--bg-hover); }
.scoped-history-item small { color: var(--text-tertiary); font-size: 11px; }
.scoped-history-empty { padding: 20px 8px; color: var(--text-tertiary); text-align: center; font-size: 12px; }
</style>
