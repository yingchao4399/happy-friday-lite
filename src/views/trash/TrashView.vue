<template>
  <div class="trash-page">
    <header class="history-header">
      <div><h1 class="page-title">{{ t('trash.title') }}</h1><p class="page-description">{{ t('trash.description') }}</p></div>
      <FridayButton compact :disabled="busy || !desktop" @click="requestEmpty"><Trash2 :size="14" />{{ t('trash.emptyAll') }}</FridayButton>
    </header>
    <FridayNotice v-if="!desktop" class="page-notice">{{ t('trash.desktopRequired') }}</FridayNotice>
    <FridayNotice v-if="message" class="page-notice" :error="hasError" role="status">{{ message }}</FridayNotice>
    <div class="filter-bar">
      <div class="search-box"><Search :size="15" /><input v-model="query" :aria-label="t('trash.search')" :placeholder="t('trash.search')" /><button v-if="query" type="button" :aria-label="t('clipboard.clearSearch')" @click="query = ''"><X :size="13" /></button></div>
      <FridaySelect v-model="kind" :options="kindOptions" :label="t('trash.allTypes')" />
    </div>
    <div class="history-scroll">
      <div class="history-content">
        <div v-if="items.length" class="batch-bar">
          <label><input type="checkbox" :checked="selected.size === items.length" :indeterminate="selected.size > 0 && selected.size < items.length" :disabled="busy" @change="selectAll" />{{ t('trash.selectAll') }}</label>
          <span>{{ t('trash.selectedCount', { count: selected.size }) }}</span>
          <FridayButton compact :disabled="busy || !selected.size" @click="restore([...selected])"><Undo2 :size="14" />{{ t('trash.restore') }}</FridayButton>
          <FridayButton compact variant="danger" :disabled="busy || !selected.size" @click="confirmIds = [...selected]">{{ t('trash.permanentDelete') }}</FridayButton>
        </div>
        <div v-if="loading && !items.length" class="state-wrap"><LoaderCircle :size="28" class="spin" /><p>{{ t('trash.loading') }}</p></div>
        <div v-else-if="!items.length" class="state-wrap"><Trash2 :size="56" :stroke-width="1.2" /><h2>{{ query || kind ? t('trash.noResults') : t('trash.empty') }}</h2><p>{{ t('trash.emptyHint') }}</p></div>
        <article v-for="item in items" :key="item.id" class="trash-row" :class="{ selected: selected.has(item.id) }">
          <input type="checkbox" :aria-label="t('trash.selectItem', { title: item.title })" :checked="selected.has(item.id)" :disabled="busy" @change="toggle(item.id)" />
          <component :is="item.kind === 'note' ? FileText : item.kind === 'clipboard' ? Clipboard : Folder" :size="17" class="row-icon" />
          <div class="row-content"><h2>{{ item.title }}</h2><p v-if="item.originalPath" class="row-path" :title="item.originalPath">{{ item.originalPath }}</p><div class="row-meta"><span>{{ t('trash.' + item.kind) }}</span><time>{{ new Date(item.deletedAt).toLocaleString() }}</time><span v-if="item.expired">{{ t('trash.expired') }}</span></div></div>
          <div class="row-actions">
            <FridayButton compact :disabled="busy || item.expired" @click="restore([item.id])">{{ t('trash.restore') }}</FridayButton>
            <FridayButton v-if="item.kind !== 'clipboard'" icon-only variant="text" :disabled="busy" :title="t('trash.restoreElsewhere')" :aria-label="t('trash.restoreElsewhere')" @click="restore([item.id], { chooseLocation: true })"><FolderInput :size="15" /></FridayButton>
            <FridayButton v-if="item.kind !== 'clipboard'" icon-only variant="text" :disabled="busy" :title="t('trash.export')" :aria-label="t('trash.export')" @click="exportItem(item)"><Download :size="15" /></FridayButton>
            <FridayButton icon-only variant="danger" :disabled="busy" :title="t('trash.permanentDelete')" :aria-label="t('trash.permanentDelete')" @click="confirmIds = [item.id]"><Trash2 :size="15" /></FridayButton>
          </div>
        </article>
      </div>
    </div>
    <FridayConfirmDialog :visible="confirmIds.length > 0" :title="t('trash.permanentDelete')" :message="t('trash.confirmPermanent', { count: confirmIds.length })" :cancel-label="t('trash.cancel')" :confirm-label="t('trash.permanentDelete')" @cancel="confirmIds = []" @confirm="deleteConfirmed" />
    <FridayConfirmDialog :visible="missingNotebookIds.length > 0" :title="t('trash.restore')" :message="t('trash.missingNotebook')" :cancel-label="t('trash.cancel')" :confirm-label="t('trash.restoreWithoutNotebook')" @cancel="missingNotebookIds = []" @confirm="restoreWithoutNotebook" />
  </div>
</template>

<script setup>
import { computed, onActivated, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Clipboard, Download, FileText, Folder, FolderInput, LoaderCircle, Search, Trash2, Undo2, X } from 'lucide-vue-next'
import FridayButton from '@/components/ui/FridayButton.vue'
import FridayConfirmDialog from '@/components/ui/FridayConfirmDialog.vue'
import FridayNotice from '@/components/ui/FridayNotice.vue'
import FridaySelect from '@/components/ui/FridaySelect.vue'
import { electronService } from '@/services/electron'

const { t } = useI18n()
const desktop = electronService.isElectron
const items = ref([])
const selected = ref(new Set())
const query = ref('')
const kind = ref('')
const loading = ref(false)
const busy = ref(false)
const message = ref('')
const hasError = ref(false)
const confirmIds = ref([])
const missingNotebookIds = ref([])
const kindOptions = computed(() => ['', 'note', 'knowledge', 'clipboard'].map(value => ({ value, label: t('trash.' + (value || 'allTypes')) })))
let unlisten = null
let searchTimer = null
let requestId = 0

async function load() {
  if (!desktop) return
  const current = ++requestId
  loading.value = true
  try {
    const rows = await electronService.request('trash-list', { query: query.value, kind: kind.value })
    if (current !== requestId) return
    items.value = rows
    selected.value = new Set([...selected.value].filter(id => rows.some(item => item.id === id)))
  } catch { hasError.value = true; message.value = t('trash.loadFailed') }
  finally { if (current === requestId) loading.value = false }
}
function toggle(id) { const next = new Set(selected.value); next.has(id) ? next.delete(id) : next.add(id); selected.value = next }
function selectAll() { selected.value = selected.value.size === items.value.length ? new Set() : new Set(items.value.map(item => item.id)) }
function errorText(code) { const key = 'trash.errors.' + code; return t(key) === key ? t('trash.operationFailed') : t(key) }

async function restore(ids, options = {}) {
  if (busy.value) return
  busy.value = true
  message.value = ''
  try {
    const result = await electronService.request('trash-restore', { ids, ...options, dialogTitle: t('trash.chooseLocation') })
    if (result.canceled) return
    const failed = result.results.filter(item => !item.ok)
    missingNotebookIds.value = failed.filter(item => item.code === 'TRASH_NOTEBOOK_MISSING').map(item => item.id)
    hasError.value = failed.length > 0
    message.value = failed.length ? [...new Set(failed.map(item => errorText(item.code)))].join('；') : t('trash.restored', { count: result.results.length })
    await load()
  } catch { hasError.value = true; message.value = t('trash.operationFailed') }
  finally { busy.value = false }
}
function restoreWithoutNotebook() { const ids = [...missingNotebookIds.value]; missingNotebookIds.value = []; restore(ids, { withoutNotebook: true }) }
async function exportItem(item) {
  if (busy.value) return
  busy.value = true
  try {
    const result = await electronService.request('trash-export', { id: item.id, dialogTitle: t('trash.exportLocation') })
    if (!result.canceled) { hasError.value = false; message.value = t('trash.exported', { path: result.path }) }
  } catch { hasError.value = true; message.value = t('trash.exportFailed') }
  finally { busy.value = false }
}
async function requestEmpty() {
  if (busy.value) return
  busy.value = true
  try { confirmIds.value = (await electronService.request('trash-list')).map(item => item.id) }
  catch { hasError.value = true; message.value = t('trash.loadFailed') }
  finally { busy.value = false }
}
async function deleteConfirmed() {
  const ids = [...confirmIds.value]
  confirmIds.value = []
  if (busy.value || !ids.length) return
  busy.value = true
  try {
    const result = await electronService.request('trash-delete-permanent', { ids, confirmed: true })
    const failed = result.results.filter(item => !item.ok)
    hasError.value = failed.length > 0
    message.value = failed.length ? t('trash.operationFailed') : t('trash.deleted', { count: ids.length })
    await load()
  } catch { hasError.value = true; message.value = t('trash.operationFailed') }
  finally { busy.value = false }
}
watch([query, kind], () => { clearTimeout(searchTimer); searchTimer = setTimeout(load, 180) })
onMounted(() => { load(); unlisten = electronService.listen('trash-changed', load) })
onActivated(load)
onUnmounted(() => { unlisten?.(); clearTimeout(searchTimer); requestId++ })
</script>

<style scoped>
/* 对齐官方 HistoryList 的居中内容、全宽滚动层和行式列表。 */
.trash-page { display:flex; flex-direction:column; align-items:center; width:100%; height:100%; background:var(--bg-primary); color:var(--text-primary); overflow:hidden; }
.history-header { width:100%; max-width:720px; padding:28px 24px 0; box-sizing:border-box; flex-shrink:0; display:flex; align-items:flex-start; justify-content:space-between; gap:16px; }
.page-title { margin:0; font-size:20px; font-weight:700; letter-spacing:-.03em; }
.page-description { margin:5px 0 0; color:var(--text-secondary); font-size:13px; line-height:1.5; }
.page-notice { width:calc(100% - 48px); max-width:672px; margin:12px auto 0; }
.filter-bar { width:100%; max-width:720px; padding:16px 24px 8px; box-sizing:border-box; display:flex; gap:10px; flex-shrink:0; }
.search-box { flex:1; min-width:0; display:flex; align-items:center; gap:8px; padding:9px 14px; background:var(--bg-secondary); border:1.5px solid transparent; border-radius:10px; color:var(--text-tertiary); transition:all .2s ease; }
.search-box:focus-within { border-color:var(--border-color); background:var(--bg-primary); box-shadow:0 0 0 3px var(--accent-light); }
.search-box input { flex:1; min-width:0; outline:none; border:none; background:transparent; color:var(--text-primary); font:inherit; font-size:13.5px; }
.search-box input::placeholder { color:var(--text-tertiary); }
.search-box button { display:flex; align-items:center; justify-content:center; padding:0; width:18px; height:18px; border:0; border-radius:4px; background:transparent; color:var(--text-tertiary); cursor:pointer; }
.search-box button:hover { background:var(--bg-hover); color:var(--text-primary); }
.filter-bar :deep(.friday-select) { height:38px; min-width:116px; }
.history-scroll { flex:1; overflow-y:auto; overflow-x:hidden; width:100%; }
.history-scroll::-webkit-scrollbar { width:5px; }
.history-scroll::-webkit-scrollbar-thumb { background:var(--border-color); border-radius:3px; }
.history-content { width:100%; max-width:720px; padding:0 24px 32px; box-sizing:border-box; margin:0 auto; }
.batch-bar { display:flex; align-items:center; gap:10px; padding:10px 4px; flex-wrap:wrap; color:var(--text-secondary); font-size:12.5px; }
.batch-bar label { display:flex; align-items:center; gap:6px; cursor:pointer; }
.batch-bar > span { flex:1; }
input[type=checkbox] { width:16px; height:16px; accent-color:var(--text-primary); flex-shrink:0; }
.trash-row { display:flex; align-items:flex-start; gap:12px; padding:14px 12px; border:1px solid transparent; border-radius:10px; transition:all .15s ease; }
.trash-row:hover, .trash-row.selected { background:var(--bg-secondary); border-color:var(--border-color); }
.row-icon { color:var(--text-tertiary); flex-shrink:0; margin-top:2px; }
.row-content { flex:1; min-width:0; }
.row-content h2 { font-size:14px; font-weight:600; line-height:22px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.row-path { font-size:12.5px; line-height:1.5; color:var(--text-tertiary); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.row-meta { display:flex; gap:10px; flex-wrap:wrap; color:var(--text-tertiary); font-size:12px; margin-top:5px; }
.row-actions { display:flex; gap:2px; flex-shrink:0; }
.state-wrap { display:flex; flex-direction:column; align-items:center; justify-content:center; padding:80px 0; gap:12px; text-align:center; color:var(--text-tertiary); font-size:13px; }
.state-wrap > svg { opacity:.5; }
.state-wrap h2 { font-size:15px; font-weight:600; color:var(--text-secondary); }
.spin { animation:spin .7s linear infinite; }
@keyframes spin { to { transform:rotate(360deg); } }
@media(max-width:700px) { .trash-row { flex-wrap:wrap; } .row-content { flex-basis:calc(100% - 64px); } .row-actions { margin-left:52px; } .history-header { flex-wrap:wrap; } }
</style>
