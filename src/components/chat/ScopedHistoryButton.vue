<template>
  <div class="scoped-history" @keydown.esc="open = false">
    <button ref="triggerRef" class="scoped-history-toggle" type="button" :title="title || t('friday.historyTitle')" :aria-expanded="open" @click="toggle">
      <History :size="16" :stroke-width="2" />
      <span v-if="label">{{ label }}</span>
    </button>
    <Teleport to="body">
    <div v-if="open" ref="panelRef" class="scoped-history-panel" :style="panelStyle" :aria-label="panelTitle" @keydown.esc.stop="open = false">
      <div class="scoped-history-heading">
        <strong>{{ panelTitle }}</strong>
        <div class="scoped-history-heading-actions">
          <button type="button" :title="t('friday.newConversation')" @click="create"><Plus :size="16" /></button>
          <button type="button" :title="t('friday.historyCollapse')" @click="open = false"><X :size="16" /></button>
        </div>
      </div>
      <label class="scoped-history-search">
        <Search :size="14" />
        <input v-model="query" type="search" :placeholder="t('friday.historySearch')" />
      </label>
      <div class="scoped-history-views" role="tablist" :aria-label="panelTitle">
        <button v-for="item in views" :key="item" type="button" role="tab" :aria-selected="view === item" :class="{ active: view === item }" @click="changeView(item)">{{ t(`friday.scopedHistory.${item}`) }}</button>
      </div>
      <div v-if="error" class="scoped-history-error" role="alert">{{ error }}</div>
      <div v-if="loading" class="scoped-history-empty">{{ t('friday.scopedHistory.loading') }}</div>
      <div v-else-if="!filteredSessions.length" class="scoped-history-empty">{{ t(query ? 'friday.historyNoMatch' : 'friday.scopedHistory.empty') }}</div>
      <div v-else class="scoped-history-list">
        <div v-for="session in filteredSessions" :key="session.id" class="scoped-history-item" :class="{ active: session.id === currentSessionId }">
          <template v-if="editingId === session.id">
            <input v-model="editingTitle" class="scoped-history-rename" :aria-label="t('friday.scopedHistory.rename')" maxlength="120" @keydown.enter.prevent="commitRename(session)" @keydown.esc.stop="editingId = ''" />
            <button type="button" class="scoped-history-action" :title="t('friday.scopedHistory.save')" @click="commitRename(session)"><Check :size="14" /></button>
          </template>
          <template v-else>
            <button type="button" class="scoped-history-session" :disabled="view !== 'active'" @click="select(session)">
              <span class="scoped-history-title"><Pin v-if="session.pinnedAt" :size="12" />{{ session.title || t('friday.scopedHistory.untitled') }}</span>
              <span v-if="session.preview" class="scoped-history-preview">{{ session.preview }}</span>
              <small>{{ format(session.updatedAt) }}<span v-if="session.agentId || session.modelId"> · {{ session.agentId || session.modelId }}</span></small>
            </button>
            <button type="button" class="scoped-history-action" :title="t('friday.moreActions')" :aria-expanded="menuId === session.id" @click="menuId = menuId === session.id ? '' : session.id"><MoreHorizontal :size="16" /></button>
          </template>
          <div v-if="menuId === session.id" class="scoped-history-menu">
            <button v-if="view === 'active'" type="button" @click="beginRename(session)"><Pencil :size="14" />{{ t('friday.scopedHistory.rename') }}</button>
            <button v-if="view === 'active'" type="button" @click="setPinned(session)"><Pin :size="14" />{{ t(session.pinnedAt ? 'friday.scopedHistory.unpin' : 'friday.scopedHistory.pin') }}</button>
            <button v-if="view !== 'trash'" type="button" @click="setArchived(session)"><Archive :size="14" />{{ t(view === 'archived' ? 'friday.scopedHistory.unarchive' : 'friday.scopedHistory.archive') }}</button>
            <button v-if="view !== 'trash'" type="button" @click="moveToTrash(session)"><Trash2 :size="14" />{{ t('friday.scopedHistory.delete') }}</button>
            <button v-if="view === 'trash'" type="button" @click="restore(session)"><RotateCcw :size="14" />{{ t('friday.scopedHistory.restore') }}</button>
          </div>
        </div>
      </div>
    </div>
    </Teleport>
  </div>
</template>

<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Archive, Check, History, MoreHorizontal, Pencil, Pin, Plus, RotateCcw, Search, Trash2, X } from 'lucide-vue-next'
import { electronService } from '@/services/electron'

const props = defineProps({
  scope: { type: String, default: 'friday' },
  scopeKey: { type: String, default: '' },
  currentSessionId: { type: String, default: '' },
  label: { type: String, default: '' },
  title: { type: String, default: '' }
})
const emit = defineEmits(['select', 'create', 'removed'])
const { t } = useI18n()
const panelTitle = computed(() => props.title || t('friday.historyTitle'))
const views = ['active', 'archived', 'trash']
const open = ref(false)
const triggerRef = ref(null)
const panelRef = ref(null)
const panelStyle = ref({})
const loading = ref(false)
const sessions = ref([])
const query = ref('')
const view = ref('active')
const error = ref('')
const menuId = ref('')
const editingId = ref('')
const editingTitle = ref('')
let loadRevision = 0

const filteredSessions = computed(() => {
  const keyword = query.value.trim().toLocaleLowerCase()
  return sessions.value.filter(session => !keyword || `${session.title || ''} ${session.preview || ''}`.toLocaleLowerCase().includes(keyword))
})

async function load() {
  const revision = ++loadRevision
  loading.value = true
  error.value = ''
  try {
    const result = await electronService.invoke('get_sessions', { scope: props.scope, scopeKey: props.scopeKey || null, view: view.value })
    if (!Array.isArray(result)) throw new Error(t('friday.scopedHistory.loadFailed'))
    if (revision === loadRevision) sessions.value = result
  } catch (err) {
    if (revision === loadRevision) error.value = err?.message || t('friday.scopedHistory.loadFailed')
  } finally {
    if (revision === loadRevision) loading.value = false
  }
}
function positionPanel() {
  if (!open.value) return
  const rect = triggerRef.value?.getBoundingClientRect()
  if (!rect) return
  const width = Math.min(330, window.innerWidth - 24)
  const height = Math.min(440, window.innerHeight - 24)
  const left = Math.max(12, Math.min(rect.right - width, window.innerWidth - width - 12))
  const below = window.innerHeight - rect.bottom >= Math.min(260, height)
  const top = below ? rect.bottom + 6 : Math.max(12, rect.top - height - 6)
  panelStyle.value = { left: `${left}px`, top: `${top}px`, maxHeight: `${Math.max(80, window.innerHeight - top - 12)}px` }
}
async function toggle() {
  open.value = !open.value
  if (open.value) {
    await nextTick()
    positionPanel()
    load()
  }
}
function changeView(nextView) {
  view.value = nextView
  menuId.value = ''
  load()
}
function create() {
  open.value = false
  emit('create')
}
async function select(session) {
  if (view.value !== 'active' || loading.value) return
  loading.value = true
  error.value = ''
  try {
    const messages = await electronService.invoke('get_session_messages', { sessionId: session.id, scope: props.scope, scopeKey: props.scopeKey || null })
    if (!Array.isArray(messages)) throw new Error(t('friday.scopedHistory.loadFailed'))
    emit('select', { session, messages })
    open.value = false
  } catch (err) {
    error.value = err?.message || t('friday.scopedHistory.loadFailed')
  } finally { loading.value = false }
}
function beginRename(session) {
  editingId.value = session.id
  editingTitle.value = session.title || ''
  menuId.value = ''
}
async function mutate(channel, session, extra = {}) {
  error.value = ''
  try {
    const ok = await electronService.invoke(channel, { sessionId: session.id, scope: props.scope, scopeKey: props.scopeKey || null, ...extra })
    if (!ok) throw new Error(t('friday.scopedHistory.actionFailed'))
    menuId.value = ''
    await load()
    return true
  } catch (err) {
    error.value = err?.message || t('friday.scopedHistory.actionFailed')
    return false
  }
}
async function commitRename(session) {
  const title = editingTitle.value.trim()
  if (title && await mutate('update_session_title', session, { title })) editingId.value = ''
}
function setPinned(session) { mutate('set_session_pinned', session, { pinned: !session.pinnedAt }) }
async function setArchived(session) {
  if (await mutate('set_session_archived', session, { archived: view.value !== 'archived' })) emit('removed', session.id)
}
async function moveToTrash(session) {
  if (await mutate('trash_session', session)) emit('removed', session.id)
}
function restore(session) { mutate('restore_session', session) }
function format(value) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString(undefined, { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}
function closeOnOutside(event) {
  if (open.value && !triggerRef.value?.contains(event.target) && !panelRef.value?.contains(event.target)) open.value = false
}
watch(() => [props.scope, props.scopeKey], () => {
  query.value = ''
  view.value = 'active'
  if (open.value) load()
})
onMounted(() => {
  document.addEventListener('pointerdown', closeOnOutside)
  window.addEventListener('resize', positionPanel)
  window.addEventListener('scroll', positionPanel, true)
})
onUnmounted(() => {
  document.removeEventListener('pointerdown', closeOnOutside)
  window.removeEventListener('resize', positionPanel)
  window.removeEventListener('scroll', positionPanel, true)
})
</script>

<style scoped>
.scoped-history { position: relative; display: inline-flex; }
.scoped-history-toggle { display: inline-flex; align-items: center; gap: 5px; border: 0; background: transparent; color: var(--text-secondary); cursor: pointer; padding: 6px 8px; border-radius: 8px; }
.scoped-history-toggle:hover { background: var(--bg-hover); color: var(--text-primary); }
.scoped-history-panel { position: fixed; z-index: 10020; width: min(330px, calc(100vw - 24px)); overflow: auto; padding: 8px; border: 1px solid var(--border-color); border-radius: 8px; background: var(--bg-primary); box-shadow: 0 8px 24px rgba(0,0,0,.16); }
.scoped-history-heading, .scoped-history-heading-actions { display: flex; align-items: center; justify-content: space-between; gap: 4px; }
.scoped-history-heading { padding: 4px 4px 8px; color: var(--text-primary); font-size: 13px; }
.scoped-history-heading button, .scoped-history-action { display: grid; place-items: center; width: 25px; height: 25px; flex: none; border: 0; border-radius: 5px; background: transparent; color: var(--text-secondary); cursor: pointer; }
.scoped-history-heading button:hover, .scoped-history-action:hover { background: var(--bg-hover); color: var(--text-primary); }
.scoped-history-search { display: flex; align-items: center; gap: 5px; padding: 5px 7px; border: 1px solid var(--border-color); border-radius: 6px; color: var(--text-secondary); }
.scoped-history-search input { width: 100%; min-width: 0; border: 0; outline: 0; background: transparent; color: var(--text-primary); font: inherit; font-size: 12px; }
.scoped-history-views { display: flex; gap: 2px; padding: 8px 0 4px; }
.scoped-history-views button { flex: 1; border: 0; border-radius: 5px; background: transparent; color: var(--text-secondary); padding: 5px; cursor: pointer; font: inherit; font-size: 11px; }
.scoped-history-views button.active { background: var(--bg-hover); color: var(--text-primary); font-weight: 600; }
.scoped-history-list { display: flex; flex-direction: column; gap: 2px; }
.scoped-history-item { position: relative; display: flex; align-items: flex-start; gap: 2px; border-radius: 6px; }
.scoped-history-item.active, .scoped-history-item:hover { background: var(--bg-hover); }
.scoped-history-session { flex: 1; display: flex; flex-direction: column; align-items: flex-start; min-width: 0; gap: 3px; padding: 7px 4px; border: 0; background: transparent; color: var(--text-primary); text-align: left; cursor: pointer; font: inherit; }
.scoped-history-session:disabled { cursor: default; }
.scoped-history-title, .scoped-history-preview { display: flex; align-items: center; gap: 4px; overflow: hidden; width: 100%; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }
.scoped-history-preview, .scoped-history-session small { color: var(--text-tertiary); font-size: 11px; }
.scoped-history-action { margin-top: 5px; }
.scoped-history-menu { position: absolute; top: 30px; right: 2px; z-index: 1; display: flex; flex-direction: column; min-width: 125px; padding: 4px; border: 1px solid var(--border-color); border-radius: 6px; background: var(--bg-primary); box-shadow: 0 4px 12px #0002; }
.scoped-history-menu button { display: flex; align-items: center; gap: 7px; border: 0; border-radius: 4px; padding: 6px; background: transparent; color: var(--text-primary); text-align: left; cursor: pointer; font: inherit; font-size: 11px; }
.scoped-history-menu button:hover { background: var(--bg-hover); }
.scoped-history-rename { flex: 1; min-width: 0; margin: 5px 2px; padding: 4px; border: 1px solid var(--border-color); border-radius: 4px; background: var(--bg-primary); color: var(--text-primary); font: inherit; font-size: 12px; }
.scoped-history-empty { padding: 18px 8px; color: var(--text-tertiary); text-align: center; font-size: 12px; }
.scoped-history-error { padding: 6px; color: var(--color-danger, #c0392b); font-size: 11px; }
</style>
