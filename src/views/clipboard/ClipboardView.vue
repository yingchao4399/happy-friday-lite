<template>
  <div class="history-page clipboard-page" @keydown="selectionKey">
    <header class="history-header clipboard-header">
      <div><h1 class="page-title">{{ t('clipboard.title') }}</h1><p class="page-description">{{ t('clipboard.description') }}</p></div>
      <div class="header-actions"><FridayButton compact :variant="append.enabled ? 'primary' : 'secondary'" :disabled="!desktop || appendBusy || capturePaused" :aria-pressed="append.enabled" :title="t('clipboard.appendHint')" @click="toggleAppend"><ListPlus :size="15" />{{ t(append.enabled ? 'clipboard.appendStop' : 'clipboard.appendStart') }}</FridayButton><FridayButton compact :disabled="!desktop" @click="showSettings = true"><Settings2 :size="15" />{{ t('clipboard.settings') }}</FridayButton><button class="refresh-button" type="button" :disabled="loading || !desktop" @click="loadItems"><RefreshCw :size="15" :class="{ spin: loading }" />{{ t('clipboard.refresh') }}</button></div>
    </header>
    <FridayNotice v-if="!desktop" class="page-notice">{{ t('clipboard.desktopRequired') }}</FridayNotice>
    <FridayNotice v-if="notice" class="page-notice" role="status">{{ notice }}</FridayNotice>
    <FridayNotice v-if="error" class="page-notice" error>{{ error }}</FridayNotice>
    <FridayNotice v-if="capturePaused" class="page-notice">{{ t('clipboard.capturePaused') }}</FridayNotice>
    <FridayNotice v-if="append.enabled" class="page-notice">{{ t('clipboard.appendActive', { count: append.count }) }}</FridayNotice>
    <div class="filter-bar clipboard-filter-bar">
      <div class="search-box"><Search :size="15" class="search-icon" /><input v-model="query" class="search-input" type="search" :placeholder="t('clipboard.searchPlaceholder')" :aria-label="t('clipboard.searchPlaceholder')" /><button v-if="query" class="clear-btn" type="button" :aria-label="t('clipboard.clearSearch')" @click="query = ''"><X :size="13" /></button></div>
    </div>
    <div class="organization-bar">
      <FridaySelect v-model="view" :options="viewOptions" :label="t('clipboard.allRecords')" />
      <FridaySelect v-model="kind" :options="kindOptions" :label="t('clipboard.allTypes')" />
      <FridayButton compact class="filter-toggle" :aria-expanded="showFilters" :aria-controls="filterPanelId" @click="showFilters = !showFilters"><SlidersHorizontal :size="14" />{{ t('clipboard.filters') }}<span v-if="filterChips.length" class="filter-count">{{ filterChips.length }}</span><ChevronUp v-if="showFilters" :size="13" /><ChevronDown v-else :size="13" /></FridayButton>
    </div>
    <div v-if="showFilters" :id="filterPanelId" class="additional-filters" role="region" :aria-label="t('clipboard.filters')">
      <div class="group-filters"><label>{{ t('clipboard.category') }}<FridaySelect v-model="category" :options="categoryOptions" :label="t('clipboard.categories')" /></label><label>{{ t('clipboard.tags') }}<FridaySelect v-model="tag" :options="tagOptions" :label="t('clipboard.tags')" /></label></div>
      <div class="date-filters"><label>{{ t('clipboard.dateFrom') }}<input v-model="dateFrom" type="date" :max="dateTo || undefined" /></label><label>{{ t('clipboard.dateTo') }}<input v-model="dateTo" type="date" :min="dateFrom || undefined" /></label></div>
      <FridayButton v-if="filterChips.length" compact variant="text" @click="clearFilters">{{ t('clipboard.clearFilters') }}</FridayButton>
    </div>
    <div v-else-if="filterChips.length" class="filter-summary" :aria-label="t('clipboard.activeFilters')"><button v-for="filter in filterChips" :key="filter.key" type="button" :title="filter.label" :aria-label="t('clipboard.removeFilter', { filter: filter.label })" @click="removeFilter(filter.key)"><span>{{ filter.label }}</span><X :size="12" /></button></div>
    <div class="create-group-actions"><FridayButton compact :disabled="!desktop" @click="newPhrase"><Plus :size="14" />{{ t('clipboard.newPhrase') }}</FridayButton><FridayButton compact :disabled="!desktop" :title="t('clipboard.manageGroups')" @click="openGroups('categories')"><Plus :size="14" />{{ t('clipboard.newCategory') }}</FridayButton><FridayButton compact :disabled="!desktop" :title="t('clipboard.manageGroups')" @click="openGroups('tags')"><Plus :size="14" />{{ t('clipboard.newTag') }}</FridayButton><FridayButton compact class="selection-toggle" :aria-pressed="selecting" :disabled="!desktop || batchBusy" @click="toggleSelectionMode">{{ t(selecting ? 'clipboard.finishSelection' : 'clipboard.multiSelect') }}</FridayButton></div>
    <div v-if="selecting" class="selection-bar" role="region" :aria-label="t('clipboard.multiSelect')" :aria-busy="batchBusy">
      <label class="select-all"><input type="checkbox" :checked="allSelected" :indeterminate="selectedItems.length > 0 && !allSelected" :disabled="!items.length || batchBusy || loading" @change="selectAll" />{{ t('clipboard.selectAllResults') }}</label>
      <span class="selection-count" role="status">{{ t('clipboard.selectedCount', { count: selectedItems.length }) }}</span>
      <FridayButton compact :disabled="!selectedItems.length || batchBusy" @click="clearSelection">{{ t('clipboard.deselectAll') }}</FridayButton>
      <FridayButton compact class="batch-toggle" :aria-expanded="showBatchActions" :aria-controls="batchPanelId" @click="showBatchActions = !showBatchActions">{{ t('clipboard.itemActions') }}<ChevronUp v-if="showBatchActions" :size="13" /><ChevronDown v-else :size="13" /></FridayButton>
      <div v-if="showBatchActions" :id="batchPanelId" class="batch-actions"><FridayButton compact :disabled="!selectedItems.length || batchBusy || selectedSensitive" @click="startSequence">{{ t('clipboard.sequencePaste') }}</FridayButton><FridayButton compact :disabled="!selectedItems.length || batchBusy" @click="batchAction(allFavorites ? 'unfavorite' : 'favorite')">{{ t(allFavorites ? 'clipboard.batchUnfavorite' : 'clipboard.batchFavorite') }}</FridayButton><FridayButton compact :disabled="!selectedItems.length || batchBusy || selectedSensitive" :title="selectedSensitive ? t('clipboard.batchSensitiveHint') : ''" @click="organizeSelected">{{ t('clipboard.editOrganization') }}</FridayButton><FridayButton compact :disabled="selectedItems.length < 2 || batchBusy || selectedSensitive" :title="t(selectedSensitive ? 'clipboard.batchSensitiveHint' : 'clipboard.mergeCopyHint')" @click="batchAction('merge')">{{ t('clipboard.mergeCopy') }}</FridayButton><FridayButton compact variant="danger" :disabled="!selectedItems.length || batchBusy" @click="deleteSelection = selectedItems.map(item => item.id)">{{ t('clipboard.batchDelete') }}</FridayButton></div>
    </div>
    <div class="history-scroll clipboard-scroll">
      <div class="history-content clipboard-content">
        <div v-if="loading && !items.length" class="state-wrap"><LoaderCircle :size="28" class="spin state-icon" /><p class="state-text">{{ t('clipboard.loading') }}</p></div>
        <div v-else-if="!items.length" class="state-wrap"><Clipboard :size="56" :stroke-width="1.2" class="state-icon" /><p class="state-title">{{ query || kind || category || tag || dateFrom || dateTo || view !== 'all' ? t('clipboard.noResults') : t('clipboard.empty') }}</p><p class="state-text">{{ query || kind || category || tag || dateFrom || dateTo || view !== 'all' ? t('clipboard.searchHint') : t('clipboard.emptyHint') }}</p></div>
        <div v-else class="clipboard-list">
      <article v-for="item in items" :key="item.id" :data-clipboard-id="item.id" class="clipboard-row" :class="{ selected: selectedIds.has(item.id) }" tabindex="0" @click.capture="captureSelectionClick($event, item)" @click="openDetail(item)" @contextmenu.prevent="openMenu($event, item)" @keydown.enter.self.prevent="selecting ? selectItem(item, $event) : openDetail(item)" @keydown.space.self="selecting && selectBySpace($event, item)" @keydown.shift.f10.prevent="openMenu($event, item)" @keydown.contextmenu.prevent="openMenu($event, item)" @dragover.prevent @drop.prevent="!selecting && dropItem($event, item)">
        <input v-if="selecting" class="row-checkbox" type="checkbox" :checked="selectedIds.has(item.id)" :disabled="batchBusy" :aria-label="t('clipboard.selectItem', { source: sourceLabel(item.sourceApp), time: formatTime(item.capturedAt) })" @click.stop="selectItem(item, $event)" />
        <button v-else class="drag-handle" draggable="true" type="button" :title="t('clipboard.reorderHint')" :aria-label="t('clipboard.reorderHint')" @click.stop @dragstart.stop="startItemDrag($event, item)" @dragend="draggedId = ''" @keydown.alt.up.stop.prevent="keyboardMove(item, -1)" @keydown.alt.down.stop.prevent="keyboardMove(item, 1)"><GripVertical :size="14" /></button>
        <component :is="typeIcon(item.kind)" :size="18" :stroke-width="1.6" class="row-icon" :class="{ 'folder-row-icon': item.kind === 'folder' }" @click.stop="item.kind === 'folder' ? openDirectory(item) : openDetail(item)" />
        <div class="clipboard-main">
          <ClipboardImage :revision="item.hash" @saved="detailChanged" v-if="item.imagePath && item.sensitivity !== 'secret'" @click.stop :ref="component => { if (component) imageRefs.set(item.id, component); else imageRefs.delete(item.id) }" :item-id="item.id" />
          <ClipboardSecret v-else-if="item.sensitivity === 'secret'" :item="item" @click.stop />
          <ClipboardFiles v-else-if="item.filePaths?.length" :item="item" :limit="3" @contextmenu="openMenu" @changed="detailChanged" @detail="openDetail(item)" />
          <p v-else class="clipboard-preview" :class="{ 'code-preview': item.kind === 'code' }">{{ item.plainText || item.maskedPreview }}</p>
          <div v-if="item.sensitivity !== 'secret' && (item.category || item.tags?.length)" class="item-tags"><button v-if="item.category" type="button" @click.stop="category = item.category">{{ item.category }}</button><button v-for="itemTag in item.tags" :key="itemTag" type="button" @click.stop="tag = itemTag">#{{ itemTag }}</button></div>
          <div class="clipboard-meta"><span>{{ typeLabel(item.kind) }}</span><span>{{ t('clipboard.source') }}: {{ sourceLabel(item.sourceApp) }}</span><time>{{ formatTime(item.capturedAt) }}</time><Pin v-if="item.pinned" :size="11" /><Star v-if="item.favorite" :size="12" /><span v-if="item.phrase">{{ t('clipboard.phrases') }}</span><span v-if="(item.note || item.hasNote)" class="has-memo">{{ t('clipboard.hasMemo') }}</span><span v-if="copiedId === item.id" class="copied-feedback" role="status"><Check :size="12" />{{ t('clipboard.copied') }}</span></div>
          <div v-if="item.ai" class="ai-state" :class="{ failed: item.ai.status === 'failed' }" role="status"><Sparkles :size="12" /><span>{{ item.ai.code ? aiError(item.ai.code) : t('clipboard.aiStatus.' + item.ai.status) }}</span><button v-if="item.ai.noteId" type="button" @click="router.push('/note/' + item.ai.noteId)">{{ t('clipboard.openNote') }}</button></div>
        </div>
        <div class="clipboard-actions" @click.stop><FridayButton icon-only variant="text" :disabled="pendingIds.has(item.id)" :class="{ favorited: item.favorite }" :title="t(item.favorite ? 'clipboard.unfavorite' : 'clipboard.favorite')" :aria-label="t(item.favorite ? 'clipboard.unfavorite' : 'clipboard.favorite')" :aria-pressed="item.favorite" @click="toggleFavorite(item)"><Star :size="15" :fill="item.favorite ? 'currentColor' : 'none'" /></FridayButton><FridayButton compact :disabled="pendingIds.has(item.id)" @click="requestUse(item)"><Copy :size="14" />{{ t(item.filePaths?.length ? 'clipboard.copyFile' : 'clipboard.copy') }}</FridayButton><FridayButton v-if="item.filePaths?.length" compact :disabled="pendingIds.has(item.id)" @click="useItem(item, false, 'path')">{{ t('clipboard.copyPath') }}</FridayButton><FridayButton icon-only variant="text" :disabled="pendingIds.has(item.id)" :class="{ pinned: item.pinned }" :title="item.pinned ? t('clipboard.unpin') : t('clipboard.pin')" :aria-label="item.pinned ? t('clipboard.unpin') : t('clipboard.pin')" :aria-pressed="item.pinned" @click="togglePinned(item)"><PinOff v-if="item.pinned" :size="15" /><Pin v-else :size="15" /></FridayButton><FridayButton icon-only variant="text" :aria-label="t('clipboard.itemActions')" :title="t('clipboard.itemActions')" @click="openMenu($event, item)"><MoreHorizontal :size="16" /></FridayButton></div>
      </article>
        </div>
      </div>
    </div>
    <FridayConfirmDialog :visible="!!sensitiveItem" :title="t('clipboard.secret')" :message="t('clipboard.confirmSecret')" :cancel-label="t('clipboard.cancel')" :confirm-label="t('clipboard.use')" @cancel="sensitiveItem = null" @confirm="confirmUse" />
    <ClipboardSettings :visible="showSettings" @close="showSettings = false" @changed="loadItems" />
    <ClipboardContextMenu :item="contextItem" :x="menuPosition.x" :y="menuPosition.y" :busy="contextItem && pendingIds.has(contextItem.id)" @close="contextItem = null" @action="menuAction" />
    <ClipboardOrganize :visible="showOrganize" :item="organizeItem" :phrase="editingPhrase" :batch-ids="organizeIds" :groups="groups" @close="showOrganize = false" @changed="organizedChanged" />
    <FridayConfirmDialog :visible="deleteSelection.length > 0" :title="t('clipboard.batchDelete')" :message="t('clipboard.batchDeleteConfirm', { count: deleteSelection.length })" :cancel-label="t('clipboard.cancel')" :confirm-label="t('clipboard.delete')" @cancel="deleteSelection = []" @confirm="confirmBatchDelete" />
    <ClipboardGroups :initial-type="groupType" :visible="showGroups" :groups="groups" @close="showGroups = false" @changed="loadItems" />
    <ClipboardDetailDialog :visible="!!detailItem" :item="detailItem" @close="detailItem = null" @changed="detailChanged" @contextmenu="openMenu" @qr="openQr" @copy="requestUse" />
    <ClipboardQrDialog :visible="!!qrItem" :item="qrItem" @close="qrItem = null" />
    <ClipboardFileActions :visible="!!fileActionItem" :item="fileActionItem" :mode="fileActionMode" @close="fileActionItem = null" />
  </div>
</template>

<script setup>
import { computed, onActivated, onDeactivated, onMounted, onUnmounted, ref, useId, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { Check, Clipboard, Copy, File, Folder, Image, Link, LoaderCircle, LockKeyhole, Pin, PinOff, RefreshCw, Search, Settings2, Text, Trash2, X } from 'lucide-vue-next'
import ClipboardImage from './ClipboardImage.vue'
import ClipboardFileActions from './ClipboardFileActions.vue'
import ClipboardFiles from './ClipboardFiles.vue'
import ClipboardSecret from './ClipboardSecret.vue'
import ClipboardSettings from './ClipboardSettings.vue'
import ClipboardContextMenu from './ClipboardContextMenu.vue'
import ClipboardOrganize from './ClipboardOrganize.vue'
import ClipboardGroups from './ClipboardGroups.vue'
import ClipboardDetailDialog from './ClipboardDetailDialog.vue'
import ClipboardQrDialog from './ClipboardQrDialog.vue'
import { ChevronDown, ChevronUp, GripVertical, ListPlus, MoreHorizontal, Plus, SlidersHorizontal, Sparkles, Star } from 'lucide-vue-next'
import FridayButton from '@/components/ui/FridayButton.vue'
import FridayConfirmDialog from '@/components/ui/FridayConfirmDialog.vue'
import FridayNotice from '@/components/ui/FridayNotice.vue'
import FridaySelect from '@/components/ui/FridaySelect.vue'
import { electronService } from '@/services/electron'
const { t, te } = useI18n()
const router = useRouter()
const desktop = electronService.isElectron
const items = ref([])
const query = ref('')
const kind = ref('')
const loading = ref(false)
const error = ref(''), notice = ref(''), groupType = ref('categories')
const copiedId = ref('')
const draggedId = ref('')
const dateFrom = ref(''), dateTo = ref(''), append = ref({ enabled: false, count: 0 }), appendBusy = ref(false)
const showFilters = ref(false), showBatchActions = ref(false), filterPanelId = useId(), batchPanelId = useId()
const sensitiveItem = ref(null)
const pendingIds = ref(new Set())
const showSettings = ref(false)
const capturePaused = ref(false)
const view = ref('all'), category = ref(''), tag = ref(''), groups = ref({ categories: [], tags: [] })
const filterChips = computed(() => [
  { key: 'category', value: category.value, label: t('clipboard.category') + ': ' + (category.value === '__uncategorized__' ? t('clipboard.uncategorized') : category.value) },
  { key: 'tag', value: tag.value, label: t('clipboard.tags') + ': ' + tag.value },
  { key: 'dateFrom', value: dateFrom.value, label: t('clipboard.dateFrom') + ': ' + dateFrom.value },
  { key: 'dateTo', value: dateTo.value, label: t('clipboard.dateTo') + ': ' + dateTo.value }
].filter(filter => filter.value))
function removeFilter(key) { const filters = { category, tag, dateFrom, dateTo }; if (filters[key]) filters[key].value = '' }
function clearFilters() { category.value = ''; tag.value = ''; dateFrom.value = ''; dateTo.value = '' }
const contextItem = ref(null), menuPosition = ref({ x: 0, y: 0 }), showGroups = ref(false), showOrganize = ref(false), organizeItem = ref(null), editingPhrase = ref(false)
const detailItem = ref(null), qrItem = ref(null), fileActionItem = ref(null), fileActionMode = ref('open')
const selecting = ref(false), selectedIds = ref(new Set()), batchBusy = ref(false), organizeIds = ref([]), deleteSelection = ref([])
let selectionAnchor = ''
const selectedItems = computed(() => items.value.filter(item => selectedIds.value.has(item.id)))
const allSelected = computed(() => items.value.length > 0 && selectedItems.value.length === items.value.length)
const allFavorites = computed(() => selectedItems.value.length > 0 && selectedItems.value.every(item => item.favorite))
const selectedSensitive = computed(() => selectedItems.value.some(item => item.sensitivity === 'secret'))
function clearSelection() { selectedIds.value = new Set(); selectionAnchor = '' }
function captureSelectionClick(event, item) {
  if (!selecting.value) return
  event.preventDefault(); event.stopPropagation()
  selectItem(item, event)
}
function toggleSelectionMode() { selecting.value = !selecting.value; showBatchActions.value = false; clearSelection() }
function selectAll() { if (!batchBusy.value && !loading.value) { selectedIds.value = allSelected.value ? new Set() : new Set(items.value.map(item => item.id)); selectionAnchor = '' } }
function selectItem(item, event = {}) {
  if (batchBusy.value) return
  const next = new Set(selectedIds.value)
  const anchor = items.value.findIndex(entry => entry.id === selectionAnchor), index = items.value.findIndex(entry => entry.id === item.id)
  if (event.shiftKey && anchor >= 0 && index >= 0) { for (const entry of items.value.slice(Math.min(anchor, index), Math.max(anchor, index) + 1)) next.add(entry.id) }
  else if (next.has(item.id)) next.delete(item.id)
  else next.add(item.id)
  selectedIds.value = next; selectionAnchor = item.id
}
function selectBySpace(event, item) { event.preventDefault(); selectItem(item, event) }
function selectionKey(event) {
  if (event.target.closest?.('input,textarea,select,[contenteditable=true]')) return
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a' && desktop && !batchBusy.value) { event.preventDefault(); selecting.value = true; selectedIds.value = new Set(items.value.map(item => item.id)) }
  if (event.key === 'Escape' && selecting.value && !batchBusy.value) { event.preventDefault(); selecting.value = false; showBatchActions.value = false; clearSelection() }
}
function organizeSelected() { organizeItem.value = null; editingPhrase.value = false; organizeIds.value = selectedItems.value.map(item => item.id); showOrganize.value = true }
async function batchAction(action, ids = selectedItems.value.map(item => item.id)) {
  if (batchBusy.value || !ids.length) return
  batchBusy.value = true; error.value = ''; notice.value = ''
  try {
    const result = await electronService.batchClipboardItems({ ids: [...ids], action })
    if (action === 'merge') await electronService.request('clipboard-use', { id: result.id })
    notice.value = t(action === 'merge' ? 'clipboard.batchMerged' : 'clipboard.batchCompleted', { count: ids.length })
    clearSelection(); await loadItems()
  } catch (e) {
    const code = ['INVALID', 'STALE', 'SENSITIVE', 'MERGE_LIMIT', 'TAG_LIMIT'].find(code => e.message?.includes('CLIPBOARD_BATCH_' + code))
    error.value = code ? t('clipboard.batchErrors.' + code) : t('clipboard.batchFailed')
    await loadItems()
  } finally { batchBusy.value = false }
}
async function startSequence() {
  batchBusy.value = true; error.value = ''
  try { await electronService.startClipboardQueue(selectedItems.value.map(item => item.id)) }
  catch (e) { const code = e.code || String(e.message).match(/CLIPBOARD_[A-Z_]+/)?.[0]; error.value = code ? t('clipboard.desktopErrors.' + code, t('clipboard.pasteFailed')) : t('clipboard.pasteFailed') }
  finally { batchBusy.value = false }
}
async function confirmBatchDelete() { const ids = [...deleteSelection.value]; deleteSelection.value = []; await batchAction('delete', ids) }
watch(items, current => { selectedIds.value = new Set([...selectedIds.value].filter(id => current.some(item => item.id === id))) })
watch([query, kind, view, category, tag, dateFrom, dateTo], clearSelection)
const imageRefs = new Map()
const viewOptions = computed(() => ['all', 'favorites', 'phrases', 'pinned'].map(value => ({ value, label: t('clipboard.' + ({ all: 'allRecords' }[value] || value)) })))
const categoryOptions = computed(() => [{ value: '', label: t('clipboard.allCategories') }, { value: '__uncategorized__', label: t('clipboard.uncategorized') }, ...groups.value.categories.map(value => ({ value, label: value }))])
const tagOptions = computed(() => [{ value: '', label: t('clipboard.allTags') }, ...groups.value.tags.map(value => ({ value, label: value }))])
const aiError = code => t('clipboard.aiErrors.' + code, t('clipboard.aiFailed'))
let unlistenAppend = null
let unlistenAi = null
let unlistenAdded = null
let unlistenHotkey = null
let unlistenTrash = null
let unlistenSettings = null
let unlistenCapability = null
let searchTimer = null
let feedbackTimer = null
let requestId = 0
const kinds = ['text', 'html', 'link', 'image', 'audio', 'video', 'code', 'file', 'folder', 'mixed', 'secret']
const kindOptions = computed(() => [{ value: '', label: t('clipboard.allTypes') }, ...kinds.map(value => ({ value, label: t(`clipboard.${value}`) }))])
const formatTime = value => value ? new Date(value).toLocaleString() : ''
const typeLabel = value => t(`clipboard.${value}`, value)
const sourceLabel = value => value === 'friday-merge' ? t('clipboard.sourceMerge') : value === 'screen-recording' ? t('clipboard.sourceRecording') : value === 'friday-phrase' ? t('clipboard.sourcePhrase') : value === 'system-clipboard' ? t('clipboard.sourceSystem') : (value || t('clipboard.sourceUnknown'))
const typeIcon = value => ({ image: Image, file: File, folder: Folder, secret: LockKeyhole, link: Link })[value] || Text
async function loadItems() {
  if (!desktop) return
  const current = ++requestId
  loading.value = true; error.value = ''
  try { const [result, organization] = await Promise.all([electronService.request('clipboard-list', { query: query.value, kind: kind.value, view: view.value, category: category.value, tag: tag.value, dateFrom: dateFrom.value, dateTo: dateTo.value }), electronService.getClipboardOrganization()]); if (current === requestId && Array.isArray(result)) { items.value = result; groups.value = organization; if (category.value && category.value !== '__uncategorized__' && !organization.categories.includes(category.value)) category.value = ''; if (tag.value && !organization.tags.includes(tag.value)) tag.value = '' } } catch (e) { if (current === requestId) error.value = e.message || t('clipboard.useFailed') } finally { if (current === requestId) loading.value = false }
}
function requestUse(item) { if (item.sensitivity === 'secret') sensitiveItem.value = item; else useItem(item) }
function confirmUse() { const item = sensitiveItem.value; sensitiveItem.value = null; if (item) useItem(item, true) }
async function withPending(item, action) {
  if (pendingIds.value.has(item.id)) return
  pendingIds.value = new Set([...pendingIds.value, item.id]); error.value = ''
  try { await action() } catch (e) { const code = e.code || String(e.message).match(/CLIPBOARD_[A-Z_]+/)?.[0]; error.value = code ? (te('clipboard.aiErrors.' + code) ? aiError(code) : t('clipboard.useFailed')) : e.message || t('clipboard.useFailed') } finally { const next = new Set(pendingIds.value); next.delete(item.id); pendingIds.value = next }
}
async function useItem(item, confirmSensitive = false, mode = 'content') {
  await withPending(item, async () => { await electronService.request('clipboard-use', { id: item.id, confirmSensitive, mode, index: item.targetFileIndex }); copiedId.value = item.id; clearTimeout(feedbackTimer); feedbackTimer = setTimeout(() => { copiedId.value = '' }, 2200) })
}
function openMenu(event, item) { const rect = event.currentTarget?.getBoundingClientRect?.() || { left: 16, bottom: 16 }; menuPosition.value = { x: event.clientX || rect.left + 12, y: event.clientY || rect.bottom }; contextItem.value = item }
async function toggleAppend() { appendBusy.value = true; error.value = ''; try { append.value = await electronService.setClipboardAppend(!append.value.enabled) } catch { error.value = t('clipboard.appendFailed') } finally { appendBusy.value = false } }
function openGroups(type) { groupType.value = type; showGroups.value = true }
async function organizedChanged(item) {
  if (organizeIds.value.length) { notice.value = t('clipboard.batchCompleted', { count: organizeIds.value.length }); organizeIds.value = []; clearSelection() }
  if (item?.phrase && editingPhrase.value) { view.value = 'phrases'; query.value = ''; kind.value = ''; category.value = ''; tag.value = ''; dateFrom.value = ''; dateTo.value = ''; notice.value = t('clipboard.phraseSaved') }
  await loadItems()
}
function newPhrase() { organizeIds.value = []; organizeItem.value = null; editingPhrase.value = true; showOrganize.value = true }
function openDetail(item) { detailItem.value = item }
function openQr(item) { if (item.sensitivity === 'secret') return; detailItem.value = null; qrItem.value = item }
function startItemDrag(event, item) { draggedId.value = item.id; event.dataTransfer.setData('application/x-friday-clipboard-id', item.id); event.dataTransfer.effectAllowed = 'move' }
async function dropItem(event, target) {
  const id = event.dataTransfer.getData('application/x-friday-clipboard-id')
  if (!id || id !== draggedId.value || id === target.id) return
  const rect = event.currentTarget.getBoundingClientRect()
  await withPending(target, async () => { await electronService.request('clipboard-reorder', { id, beforeId: target.id, after: event.clientY > rect.top + rect.height / 2 }); await loadItems() })
  draggedId.value = ''
}
async function keyboardMove(item, offset) {
  const same = items.value.filter(entry => Boolean(entry.pinned) === Boolean(item.pinned))
  const target = same[same.findIndex(entry => entry.id === item.id) + offset]
  if (!target) return
  await withPending(item, async () => { await electronService.request('clipboard-reorder', { id: item.id, beforeId: target.id, after: offset > 0 }); await loadItems() })
}
async function openDirectory(item) {
  try { await electronService.request('clipboard-file-open', { id: item.id, index: 0, mode: 'open' }) }
  catch (e) { error.value = t(e.message?.includes('MISSING') ? 'clipboard.fileMissing' : 'clipboard.fileOpenFailed') }
}
function detailChanged(updated) { const item = items.value.find(entry => entry.id === updated.id); if (item) Object.assign(item, updated); if (detailItem.value?.id === updated.id) detailItem.value = { ...updated } }
async function menuAction(action) {
  const item = contextItem.value; contextItem.value = null
  if (!item) return
  if (action === 'copy') return requestUse(item)
  if (['open-file', 'open-folder'].includes(action)) {
    const mode = action === 'open-file' ? 'open' : 'folder'
    if (item.filePaths.length > 1 && !Number.isInteger(item.targetFileIndex)) { fileActionItem.value = item; fileActionMode.value = mode; return }
    return withPending(item, async () => { try { await electronService.request('clipboard-file-open', { id: item.id, index: item.targetFileIndex ?? 0, mode }) } catch { throw new Error(t('clipboard.fileOpenFailed')) } })
  }
  if (['path', 'text'].includes(action)) return useItem(item, false, action)
  if (action === 'preview') return imageRefs.get(item.id)?.openPreview()
  if (action === 'qr') return openQr(item)
  if (action === 'pin') return togglePinned(item)
  if (action === 'desktop-pin') return withPending(item, () => electronService.pinClipboardItem(item.id))
  if (action === 'delete') return removeItem(item)
  if (['organize', 'edit'].includes(action)) { organizeIds.value = []; organizeItem.value = item; editingPhrase.value = action === 'edit'; showOrganize.value = true; return }
  await withPending(item, async () => {
    if (['favorite', 'phrase'].includes(action)) await electronService.request('clipboard-update', { id: item.id, [action]: !item[action] })
    if (action === 'note') { const result = await electronService.saveClipboardToNote(item.id); await router.push('/note/' + result.noteId) }
    if (action === 'ai') { const result = await electronService.analyzeClipboardItem(item.id); if (result.code) error.value = aiError(result.code) }
    await loadItems()
  })
}
async function toggleFavorite(item) { await withPending(item, async () => { await electronService.request('clipboard-update', { id: item.id, favorite: !item.favorite }); await loadItems() }) }
async function togglePinned(item) { await withPending(item, async () => { await electronService.request('clipboard-update', { id: item.id, pinned: !item.pinned }); await loadItems() }) }
async function removeItem(item) { await withPending(item, async () => { await electronService.request('clipboard-delete', { ids: [item.id] }); await loadItems() }) }
watch(query, () => { clearTimeout(searchTimer); searchTimer = setTimeout(loadItems, 180) })
watch(kind, loadItems)
watch([view, category, tag, dateFrom, dateTo], loadItems)
function recordingProblem(code) { return t('clipboard.recordingErrors.' + code, t('clipboard.recordingCaptureFailed')) }
function loadCaptureStatus() { if (desktop) electronService.getClipboardSettings().then(settings => { capturePaused.value = !settings.captureEnabled; if (settings.recordingIssue) notice.value = recordingProblem(settings.recordingIssue.code) }).catch(() => {}) }
onMounted(() => { loadItems(); loadCaptureStatus(); unlistenSettings = electronService.listen('clipboard-settings-changed', ({ payload }) => { capturePaused.value = !payload.captureEnabled; loadItems() }); unlistenAdded = electronService.listen('clipboard-item-added', loadItems); unlistenHotkey = electronService.listen('clipboard-hotkey', loadItems); unlistenTrash = electronService.listen('trash-changed', loadItems) })
onActivated(() => { loadItems(); loadCaptureStatus() })
onMounted(() => { if (desktop) { unlistenCapability = electronService.listen('capability-error', ({ payload }) => { if (payload.stage === 'clipboard-recording') notice.value = recordingProblem(payload.code); else if (payload.stage === 'clipboard-append') notice.value = t('clipboard.appendLimitReached') }); unlistenAi = electronService.listen('clipboard-ai-progress', loadItems); unlistenAppend = electronService.listen('clipboard-append-changed', ({ payload }) => { append.value = payload }); electronService.getClipboardAppend().then(value => { append.value = value }).catch(() => {}) } })
onDeactivated(() => { selecting.value = false; showBatchActions.value = false; clearSelection(); deleteSelection.value = []; showSettings.value = false; sensitiveItem.value = null; contextItem.value = null; showGroups.value = false; showOrganize.value = false; detailItem.value = null; qrItem.value = null; fileActionItem.value = null })
onUnmounted(() => { unlistenCapability?.(); unlistenAppend?.(); unlistenAi?.(); unlistenSettings?.(); unlistenAdded?.(); unlistenHotkey?.(); unlistenTrash?.(); clearTimeout(searchTimer); clearTimeout(feedbackTimer); requestId++ })
</script>

<style scoped>
.group-filters>label:last-child :deep(.dropdown-menu){left:auto;right:0}
.selection-bar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;flex-shrink:0;width:100%;max-width:720px;box-sizing:border-box;padding:8px 24px 10px;border-top:1px solid var(--border-color);font-size:12px;color:var(--text-secondary)}.select-all{display:flex;align-items:center;gap:7px;cursor:pointer}.select-all input,.row-checkbox{accent-color:var(--text-primary);width:15px;height:15px;flex-shrink:0;cursor:pointer}.row-checkbox{margin-top:3px}.batch-actions{display:flex;gap:6px;flex-wrap:wrap;width:100%}.clipboard-row.selected{background:var(--accent-light);border-color:var(--border-color)}.selection-count{margin-left:auto}.clipboard-page:has(.selection-bar) .clipboard-actions{display:none}@media(max-width:640px){.clipboard-page:has(.selection-bar) .clipboard-main{flex-basis:calc(100% - 65px)}}
.organization-bar,.additional-filters,.filter-summary,.create-group-actions{flex-shrink:0}.create-group-actions{display:flex;align-items:center;gap:6px;width:100%;max-width:720px;box-sizing:border-box;padding:0 24px 10px;flex-wrap:wrap}.selection-toggle{margin-left:auto}
.folder-row-icon{cursor:pointer;color:var(--accent-color)}
.favorited{color:var(--accent-color)}
.drag-handle{display:flex;align-items:center;justify-content:center;flex-shrink:0;padding:3px 0;margin-left:-6px;border:0;background:transparent;color:var(--text-tertiary);cursor:grab}.drag-handle:active{cursor:grabbing}.clipboard-row:has(.drag-handle:focus-visible){outline:1px solid var(--accent-color)}
.additional-filters{width:100%;max-width:720px;box-sizing:border-box;padding:0 24px 10px}.group-filters,.date-filters{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:8px}.group-filters>label{display:flex;flex:1;min-width:130px;flex-direction:column;gap:5px;font-size:12px;color:var(--text-secondary)}.group-filters :deep(.friday-select){height:32px;min-width:0}.date-filters label{display:flex;flex:1;min-width:140px;align-items:center;gap:6px;font-size:12px;color:var(--text-secondary)}.date-filters input{padding:5px 7px;width:0;flex:1;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-primary);color:var(--text-primary);font:inherit;min-width:0}.filter-count{min-width:16px;border-radius:4px;background:var(--bg-active);font-size:11px;line-height:17px}.filter-summary{display:flex;gap:6px;flex-wrap:wrap;width:100%;max-width:720px;box-sizing:border-box;padding:0 24px 8px}.filter-summary button{display:flex;align-items:center;gap:5px;max-width:100%;padding:4px 6px;border:0;border-radius:5px;background:var(--bg-secondary);color:var(--text-secondary);font:inherit;font-size:11px;cursor:pointer}.filter-summary button span{max-width:220px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.filter-summary button svg{flex-shrink:0}.filter-summary button:hover{background:var(--bg-hover);color:var(--text-primary)}.code-preview{font-family:Consolas,monospace}.header-actions{flex-wrap:wrap}
.header-actions{display:flex;align-items:center;gap:8px;flex-shrink:0}
.organization-bar{display:flex;align-items:center;gap:7px;width:100%;max-width:720px;box-sizing:border-box;padding:0 24px 8px}.organization-bar :deep(.friday-select){min-width:0;height:32px;flex:1}.organization-bar :deep(.dropdown-trigger){font-size:12px}.organization-bar :deep(.dropdown-trigger>span),.group-filters :deep(.dropdown-trigger>span){overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.filter-toggle{height:32px;flex-shrink:0}.item-tags{display:flex;gap:5px;margin-top:7px;flex-wrap:wrap}.item-tags button,.ai-state button{border:0;border-radius:4px;padding:3px 6px;background:var(--bg-secondary);color:var(--text-secondary);font:inherit;font-size:11px;cursor:pointer}.item-tags button:hover,.ai-state button:hover{background:var(--bg-hover)}.ai-state{display:flex;align-items:center;gap:5px;margin-top:7px;color:var(--text-tertiary);font-size:12px;line-height:1.5}.ai-state.failed{color:#d9544d}.clipboard-row:focus-visible{outline:2px solid var(--accent-color);outline-offset:-2px}
.clipboard-page{display:flex;flex-direction:column;align-items:center;width:100%;height:100%;background:var(--bg-primary);overflow:hidden}.clipboard-header{width:100%;max-width:720px;padding:28px 24px 0;box-sizing:border-box;flex-shrink:0;display:flex;align-items:flex-start;justify-content:space-between;gap:16px}.page-title{margin:0;color:var(--text-primary);font-size:20px;font-weight:700;letter-spacing:-.03em}.page-description{margin:5px 0 0;color:var(--text-secondary);font-size:13px;line-height:1.5}.refresh-button{height:30px;padding:0 10px;border:0;border-radius:7px;display:inline-flex;align-items:center;gap:6px;background:var(--bg-secondary);color:var(--text-primary);font:inherit;font-size:12.5px;cursor:pointer;transition:background-color .15s ease,transform .15s ease}.refresh-button:hover:not(:disabled){background:var(--bg-active)}.refresh-button:active:not(:disabled){transform:translateY(1px)}.refresh-button:disabled{opacity:.45;cursor:default}.clipboard-filter-bar{display:flex;align-items:center;justify-content:center;gap:10px;width:100%;max-width:720px;padding:16px 24px 8px;box-sizing:border-box;flex-shrink:0}.clipboard-filter-bar .search-box{display:flex;align-items:center;gap:8px;flex:1;max-width:400px;margin:0;padding:9px 14px;background:var(--bg-secondary);border:1.5px solid transparent;border-radius:10px;transition:all .2s ease;color:var(--text-tertiary)}.clipboard-filter-bar .search-box input{min-width:0;flex:1;border:0;outline:0;background:transparent;color:var(--text-primary);font:inherit;font-size:13.5px}.clipboard-filter-bar .search-box input::placeholder{color:var(--text-tertiary)}.clipboard-filter-bar .search-box:focus-within{border-color:var(--border-color);background:var(--bg-primary);box-shadow:0 0 0 3px var(--accent-light)}.clipboard-filter-bar .search-box input::-webkit-search-cancel-button{display:none}.clipboard-filter-bar :deep(.friday-select){height:38px;min-width:112px;flex:0 0 150px}.clipboard-filter-bar .search-icon{color:var(--text-tertiary);flex-shrink:0}.clipboard-filter-bar .clear-btn{display:flex;align-items:center;justify-content:center;width:18px;height:18px;border:0;border-radius:4px;background:transparent;color:var(--text-tertiary);cursor:pointer;flex-shrink:0;transition:all .15s}.clipboard-filter-bar .clear-btn:hover{background:var(--bg-hover);color:var(--text-primary)}.clipboard-scroll{flex:1;overflow-y:auto;overflow-x:hidden;width:100%}.clipboard-scroll::-webkit-scrollbar{width:5px}.clipboard-scroll::-webkit-scrollbar-track{background:transparent}.clipboard-scroll::-webkit-scrollbar-thumb{background:var(--border-color);border-radius:3px}.clipboard-content{width:100%;max-width:720px;padding:0 24px 32px;box-sizing:border-box;margin:0 auto}.page-notice{width:min(672px,calc(100% - 48px));margin:12px auto 0;flex-shrink:0}.state-wrap{display:flex;flex-direction:column;align-items:center;justify-content:center;padding:80px 0;gap:12px;text-align:center}.state-icon{color:var(--text-tertiary);opacity:.5}.state-title{font-size:15px;font-weight:600;color:var(--text-secondary)}.state-text{font-size:13px;color:var(--text-tertiary);line-height:1.6}.clipboard-list{display:flex;flex-direction:column;gap:4px}.clipboard-row{display:flex;align-items:flex-start;gap:14px;padding:14px 12px;border:1px solid transparent;border-radius:10px;transition:all .15s ease}.clipboard-row:hover{background:var(--bg-secondary);border-color:var(--border-color)}.row-icon{color:var(--text-tertiary);flex-shrink:0;margin-top:3px}.clipboard-main{min-width:0;flex:1}.clipboard-preview{white-space:pre-wrap;overflow:hidden;max-height:84px;line-height:1.6;word-break:break-word;font-size:13px;user-select:text;-webkit-user-select:text}.clipboard-image{max-width:220px;max-height:120px;object-fit:contain;border-radius:6px}.clipboard-meta{display:flex;align-items:center;gap:10px;margin-top:7px;color:var(--text-tertiary);font-size:12px;flex-wrap:wrap}.clipboard-actions{display:flex;align-items:center;gap:4px;flex-shrink:0}.copied-feedback{display:flex;align-items:center;gap:3px;color:#3c8056}.pinned{color:var(--accent-color)}.spin{animation:spin .7s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}
@media(max-width:640px){.clipboard-header{padding:20px 20px 0;flex-wrap:wrap;gap:12px}.clipboard-filter-bar{padding:12px 20px 8px}.clipboard-filter-bar .search-box{max-width:none}.organization-bar,.additional-filters,.filter-summary,.create-group-actions,.selection-bar{padding-left:20px;padding-right:20px}.organization-bar{gap:6px}.create-group-actions{gap:5px}.create-group-actions :deep(.friday-button){padding-left:7px;padding-right:7px;gap:4px}.page-notice{width:calc(100% - 40px)}.clipboard-row{flex-wrap:wrap;gap:10px}.clipboard-actions{margin-left:28px}.clipboard-main{flex-basis:calc(100% - 40px)}}
</style>
