<template>
  <section class="clipboard-quick" @keydown.esc="hide">
    <header><strong>{{ t('clipboard.quickTitle') }}</strong><div><FridayButton compact variant="text" @click="full">{{ t('clipboard.openManager') }}</FridayButton><FridayButton icon-only variant="text" :title="t('clipboard.close')" @click="hide"><X :size="16" /></FridayButton></div></header>
    <div class="quick-target"><span>{{ t('clipboard.pasteTarget') }}</span><strong>{{ state.target.available ? state.target.label : t('clipboard.noPasteTarget') }}</strong><p>{{ t('clipboard.pasteTargetHint') }}</p></div>
    <FridayNotice v-if="error" error role="alert">{{ error }}</FridayNotice>
    <section v-if="queue.active" class="queue-panel" :aria-label="t('clipboard.sequencePaste')">
      <strong>{{ t('clipboard.queuePosition', { current: queue.position + 1, total: queue.total }) }}</strong>
      <p>{{ currentItem?.maskedPreview || currentItem?.plainText || currentItem?.kind || t('clipboard.queueUnavailable') }}</p>
      <div class="queue-actions"><FridayButton compact variant="primary" :disabled="busy || queue.busy || queue.paused || !state.target.available" @click="queueAction('next')">{{ t('clipboard.queueNext') }}</FridayButton><FridayButton compact :disabled="busy" @click="queueAction('pause', { paused: !queue.paused })">{{ t(queue.paused ? 'clipboard.queueResume' : 'clipboard.queuePause') }}</FridayButton><FridayButton compact :disabled="busy || queue.busy" @click="queueAction('skip')">{{ t('clipboard.queueSkip') }}</FridayButton><FridayButton compact :disabled="busy" @click="queueAction('cancel')">{{ t('clipboard.queueCancel') }}</FridayButton></div>
      <label class="arm-setting"><input type="checkbox" :checked="queue.armed" :disabled="busy || queue.paused || !state.target.available" @change="arm" />{{ t('clipboard.queueArm') }}</label>
      <p v-if="queue.armed" class="shortcut-hint">{{ queue.shortcut.replace('CommandOrControl', 'Ctrl') }} · {{ t('clipboard.queueArmedHint') }}</p>
    </section>
    <div class="quick-search"><Search :size="15" /><input v-model="query" type="search" :placeholder="t('clipboard.searchPlaceholder')" :aria-label="t('clipboard.searchPlaceholder')" /></div>
    <main :aria-busy="loading">
      <p v-if="!items.length" class="empty">{{ t(loading ? 'clipboard.loading' : 'clipboard.noResults') }}</p>
      <article v-for="item in items" :key="item.id" class="quick-row" @contextmenu.prevent="openMenu($event, item)">
        <button class="quick-preview" type="button" @click="detail = item">
          <img v-if="thumbnails[item.id]" :src="thumbnails[item.id]" :alt="t('clipboard.image')" />
          <span>{{ item.sensitivity === 'secret' ? t('clipboard.secret') : item.plainText || item.filePaths?.join('\n') || t('clipboard.image') }}</span>
          <small>{{ item.sourceApp }} · {{ new Date(item.capturedAt).toLocaleString() }}</small>
        </button>
        <div class="row-actions"><FridayButton compact :disabled="busy" @click="copy(item)">{{ t('clipboard.copy') }}</FridayButton><FridayButton compact :disabled="busy || !state.target.available || !state.supported || queue.active" :title="t('clipboard.pasteTargetHint')" @click="requestPaste(item)">{{ t('clipboard.pasteExternal') }}</FridayButton></div>
      </article>
    </main>
    <ClipboardDetailDialog :visible="!!detail" :item="detail" @close="detail = null" @copy="copy(detail)" @qr="qr = detail; detail = null" @changed="changed" @contextmenu="openMenu" />
    <ClipboardContextMenu :item="menuItem" :x="menuPosition.x" :y="menuPosition.y" @close="menuItem = null" @action="menuAction" />
    <ClipboardOrganize :visible="showOrganize" :item="organizeItem" :phrase="editingPhrase" :groups="groups" @close="showOrganize = false" @changed="refresh" />
    <ClipboardFileActions :visible="!!fileActionItem" :item="fileActionItem" :mode="fileActionMode" @close="fileActionItem = null" />
    <ClipboardQrDialog :visible="!!qr" :item="qr" @close="qr = null" />
    <FridayConfirmDialog :visible="!!secret" :title="t('clipboard.secret')" :message="secretPaste ? t('clipboard.confirmExternalSecret', { target: state.target.label }) : t('clipboard.confirmSecret')" :cancel-label="t('clipboard.cancel')" :confirm-label="t(secretPaste ? 'clipboard.pasteExternal' : 'clipboard.copy')" @cancel="secret = null" @confirm="confirmSecret" />
  </section>
</template>
<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Search, X } from 'lucide-vue-next'
import FridayButton from '@/components/ui/FridayButton.vue'
import FridayNotice from '@/components/ui/FridayNotice.vue'
import FridayConfirmDialog from '@/components/ui/FridayConfirmDialog.vue'
import ClipboardDetailDialog from './ClipboardDetailDialog.vue'
import ClipboardQrDialog from './ClipboardQrDialog.vue'
import ClipboardContextMenu from './ClipboardContextMenu.vue'
import ClipboardOrganize from './ClipboardOrganize.vue'
import ClipboardFileActions from './ClipboardFileActions.vue'
import { electronService } from '@/services/electron'
import { setI18nLanguage } from '@/i18n'
import { useTheme } from '@/utils/theme'

const { t, te } = useI18n()
const menuItem = ref(null), menuPosition = ref({ x: 0, y: 0 }), showOrganize = ref(false), organizeItem = ref(null), editingPhrase = ref(false), groups = ref({ categories: [], tags: [] }), fileActionItem = ref(null), fileActionMode = ref('open')
const items = ref([]), thumbnails = ref({}), query = ref(''), detail = ref(null), qr = ref(null), error = ref(''), secret = ref(null), secretPaste = ref(false), loading = ref(false), busy = ref(false)
const state = ref({ target: { available: false, label: '' }, queue: { ids: [], active: false }, supported: false })
const queue = computed(() => state.value.queue)
const allItems = ref([])
const currentItem = computed(() => allItems.value.find(item => item.id === queue.value.ids?.[queue.value.position]))
let alive = true, revision = 0, debounce, unlisteners = []
function displayError(e) {
  const code = e.code || String(e.message).match(/CLIPBOARD_[A-Z_]+/)?.[0]
  error.value = code && te('clipboard.desktopErrors.' + code) ? t('clipboard.desktopErrors.' + code) : t('clipboard.pasteFailed')
}
async function refresh() {
  const token = ++revision; loading.value = true
  try {
    const [list, next] = await Promise.all([electronService.request('clipboard-list'), electronService.getClipboardDesktopState()])
    if (!alive || token !== revision) return
    allItems.value = list; state.value = next
    // 搜索由后端执行，敏感内容不进入普通全文搜索。
    const filtered = query.value ? await electronService.request('clipboard-list', { query: query.value }) : list
    if (!alive || token !== revision) return
    items.value = filtered.slice(0, 80)
    thumbnails.value = {}
    for (const item of items.value.filter(item => item.sensitivity !== 'secret' && (item.imagePath || item.fileEntries?.some(file => file.kind === 'image'))).slice(0, 16)) {
      const file = item.fileEntries?.find(file => file.kind === 'image')
      try { const image = await electronService.getClipboardImage(item.id, item.imagePath ? {} : { fileIndex: file.index }); if (alive && token === revision) thumbnails.value[item.id] = image.dataUrl } catch {}
    }
  } catch (e) { if (alive && token === revision) displayError(e) }
  finally { if (alive && token === revision) loading.value = false }
}
function openMenu(event, item) { menuPosition.value = { x: event.clientX, y: event.clientY }; menuItem.value = item }
async function menuAction(action) {
  const item = menuItem.value; menuItem.value = null
  if (!item) return
  if (action === 'copy') return copy(item)
  if (action === 'qr') { qr.value = item; detail.value = null; return }
  if (action === 'preview') { detail.value = item; return }
  if (['organize', 'edit'].includes(action)) {
    try { groups.value = await electronService.getClipboardOrganization(); organizeItem.value = item; editingPhrase.value = action === 'edit'; detail.value = null; showOrganize.value = true } catch (e) { displayError(e) }
    return
  }
  if (['open-file', 'open-folder'].includes(action)) {
    const mode = action === 'open-file' ? 'open' : 'folder'
    if (item.filePaths.length > 1 && !Number.isInteger(item.targetFileIndex)) { fileActionItem.value = item; fileActionMode.value = mode; return }
    return perform(() => electronService.request('clipboard-file-open', { id: item.id, index: item.targetFileIndex ?? 0, mode }))
  }
  return perform(async () => {
    if (['path', 'text'].includes(action)) await electronService.request('clipboard-use', { id: item.id, mode: action, index: item.targetFileIndex })
    else if (action === 'desktop-pin') await electronService.pinClipboardItem(item.id)
    else if (['pin', 'favorite', 'phrase'].includes(action)) { const key = action === 'pin' ? 'pinned' : action; await electronService.request('clipboard-update', { id: item.id, [key]: !item[key] }) }
    else if (action === 'note') { const result = await electronService.saveClipboardToNote(item.id); await electronService.openClipboardNote(result.noteId) }
    else if (action === 'ai') await electronService.analyzeClipboardItem(item.id)
    else if (action === 'delete') { await electronService.request('clipboard-delete', { ids: [item.id] }); detail.value = null }
  })
}
function changed(item) { detail.value = item; refresh() }
async function perform(task) { if (busy.value) return; busy.value = true; error.value = ''; try { await task(); await refresh() } catch (e) { displayError(e); await refresh() } finally { busy.value = false } }
function copy(item) { if (item.sensitivity === 'secret') { secret.value = item; secretPaste.value = false } else perform(() => electronService.request('clipboard-use', { id: item.id })) }
function requestPaste(item) { if (item.sensitivity === 'secret') { secret.value = item; secretPaste.value = true } else perform(() => electronService.pasteClipboardItem(item.id)) }
function confirmSecret() { const item = secret.value, paste = secretPaste.value; secret.value = null; perform(() => paste ? electronService.pasteClipboardItem(item.id, true) : electronService.request('clipboard-use', { id: item.id, confirmSensitive: true })) }
function queueAction(action, args) { return perform(() => electronService.clipboardQueue(action, args)) }
function arm(event) { queueAction('arm', { enabled: event.target.checked }) }
function hide() { secret.value = null; electronService.request('clipboard-quick-hide') }
function full() { electronService.request('clipboard-quick-full') }
watch(query, () => { clearTimeout(debounce); debounce = setTimeout(refresh, 180) })
onMounted(async () => {
  useTheme().initTheme()
  const config = await electronService.request('get-config').catch(() => null)
  if (config?.language) setI18nLanguage(config.language)
  unlisteners = ['clipboard-item-added', 'clipboard-item-used', 'clipboard-settings-changed', 'trash-changed'].map(channel => electronService.listen(channel, refresh))
  unlisteners.push(electronService.listen('clipboard-desktop-changed', ({ payload: next }) => { state.value = next; if (next.queue.error) displayError({ code: next.queue.error }) }))
  await refresh()
})
onUnmounted(() => { alive = false; revision++; clearTimeout(debounce); unlisteners.forEach(stop => stop?.()) })
</script>
<style scoped>
.clipboard-quick{height:100vh;display:flex;flex-direction:column;background:var(--bg-primary);color:var(--text-primary);border:1px solid var(--border-color);border-radius:10px;overflow:hidden;box-sizing:border-box;font-size:13px}header{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 12px;border-bottom:1px solid var(--border-color);-webkit-app-region:drag}header>div{display:flex;align-items:center;-webkit-app-region:no-drag}header strong{font-size:13px}.quick-target,.queue-panel{padding:12px 16px;border-bottom:1px solid var(--border-color)}.quick-target>span{color:var(--text-tertiary);margin-right:10px}.quick-target p,.queue-panel p{font-size:12px;color:var(--text-secondary);line-height:1.5;margin:6px 0 0}.queue-panel>p{white-space:pre-wrap;overflow-wrap:anywhere;max-height:58px;overflow:auto}.queue-actions{display:flex;flex-wrap:wrap;gap:6px;margin:10px 0}.arm-setting{display:flex;gap:7px;align-items:center;font-size:12px;color:var(--text-secondary)}.arm-setting input{accent-color:var(--text-primary)}.quick-search{margin:12px 16px;display:flex;gap:8px;align-items:center;border:1px solid var(--border-color);border-radius:8px;padding:8px 10px;color:var(--text-tertiary)}.quick-search input{width:100%;min-width:0;border:none;outline:none;background:transparent;color:var(--text-primary);font:inherit}main{flex:1;min-height:0;overflow:auto;padding:0 16px 12px}.quick-row{padding:10px 0;border-bottom:1px solid var(--border-color)}.quick-preview{display:block;text-align:left;cursor:pointer;border:0;padding:0;width:100%;font:inherit;background:transparent;color:inherit}.quick-preview>span{white-space:pre-wrap;overflow-wrap:anywhere;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;line-height:1.6}.quick-preview img{max-width:100%;height:64px;object-fit:contain;float:left;margin:0 10px 5px 0;border-radius:4px}.quick-preview small{display:block;clear:both;color:var(--text-tertiary);font-size:11px;margin-top:6px}.row-actions{display:flex;gap:6px;justify-content:flex-end;margin-top:8px}.empty{color:var(--text-tertiary);text-align:center;margin:30px 0}.friday-notice{margin:8px 16px}button:focus-visible{outline:2px solid var(--text-primary);outline-offset:2px}@media(max-height:520px){.quick-target p{display:none}.quick-target,.queue-panel{padding:8px 12px}}
</style>
