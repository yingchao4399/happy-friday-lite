<template>
  <section class="clipboard-pinned">
    <header class="pin-title"><span>{{ t('clipboard.title') }}</span><div><FridayButton icon-only variant="text" :title="t(expanded ? 'clipboard.collapsePin' : 'clipboard.expandPin')" :aria-label="t(expanded ? 'clipboard.collapsePin' : 'clipboard.expandPin')" @click="setExpanded(!expanded)"><Minimize2 v-if="expanded" :size="15" /><Maximize2 v-else :size="15" /></FridayButton><FridayButton icon-only variant="text" :title="t('clipboard.close')" :aria-label="t('clipboard.close')" @click="close"><X :size="16" /></FridayButton></div></header>
    <main v-if="item" @contextmenu.prevent="openMenu">
      <FridayNotice v-if="error" error>{{ error }}</FridayNotice>
      <FridayNotice v-if="item.ai" :error="item.ai.status === 'failed'" role="status">{{ item.ai.code ? aiError(item.ai.code) : t('clipboard.aiStatus.' + item.ai.status) }}</FridayNotice>
      <ClipboardSecret v-if="item.sensitivity === 'secret'" :item="item" />
      <template v-else-if="!expanded"><button v-if="thumbnail" class="pin-thumbnail" @click="setExpanded(true)"><img :src="thumbnail" :alt="t('clipboard.image')" /></button><pre v-else class="compact-text" @dblclick="setExpanded(true)">{{ item.plainText || item.maskedPreview || item.filePaths?.join('\n') }}</pre></template>
      <template v-else>
        <div class="pin-images"><ClipboardImage v-for="(_, index) in imagePaths" :key="item.id + '-' + index" :item-id="item.id" :index="index" :revision="item.hash" @saved="item = $event" /></div>
        <ClipboardAsset v-for="(file, index) in mediaFiles" :key="file.index" :item-id="item.id" :index="file.index" :name="file.name" />
        <ClipboardFiles v-if="item.filePaths?.length" :item="item" @contextmenu="openMenu" @changed="item = $event" />
        <ClipboardRichText v-if="richHtml" :key="item.id" :item-id="item.id" :html="richHtml" @image-saved="item = $event" @edit="showDetail = true" />
        <pre v-else class="expanded-text" @dblclick="showDetail = true">{{ item.plainText || item.maskedPreview || item.filePaths?.join('\n') }}</pre>
        <p v-if="item.note" class="memo">{{ item.note }}</p>
      </template>
      <p class="pin-meta">{{ item.sourceApp === 'screen-recording' ? t('clipboard.sourceRecording') : item.sourceApp === 'system-clipboard' ? t('clipboard.sourceSystem') : item.sourceApp }} · {{ new Date(item.capturedAt).toLocaleString() }}</p>
    </main>
    <footer><FridayButton compact :disabled="!item" @click="copy"><Copy :size="13" />{{ t('clipboard.copy') }}</FridayButton><FridayButton compact :disabled="!item" @click="detail">{{ t('clipboard.detailTitle') }}</FridayButton><FridayButton v-if="item?.sensitivity !== 'secret'" compact :disabled="!item" :title="t('clipboard.qrButton')" :aria-label="t('clipboard.qrButton')" @click="qr"><QrCode :size="13" /></FridayButton><span v-if="copied" role="status">{{ t('clipboard.copied') }}</span></footer>
    <ClipboardDetailDialog :visible="showDetail" :item="item" @close="showDetail = false" @copy="copy" @qr="qr" @changed="item = $event" @contextmenu="openMenu" />
    <ClipboardQrDialog :visible="showQr" :item="item" @close="showQr = false" />
    <FridayConfirmDialog :visible="confirmSecret" :title="t('clipboard.secret')" :message="t('clipboard.confirmSecret')" :cancel-label="t('clipboard.cancel')" :confirm-label="t('clipboard.copy')" @cancel="confirmSecret = false" @confirm="copyConfirmed" />
    <ClipboardOrganize :visible="showOrganize" :item="item" :phrase="editingPhrase" :groups="groups" @close="showOrganize = false" @changed="refresh" />
    <ClipboardFileActions :visible="!!fileActionItem" :item="fileActionItem" :mode="fileActionMode" @close="fileActionItem = null" />
    <ClipboardContextMenu :item="menuItem" :x="menuPosition.x" :y="menuPosition.y" screen-pinned @close="menuItem = null" @action="menuAction" />
  </section>
</template>
<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Copy, Maximize2, Minimize2, QrCode, X } from 'lucide-vue-next'
import FridayButton from '@/components/ui/FridayButton.vue'
import FridayNotice from '@/components/ui/FridayNotice.vue'
import FridayConfirmDialog from '@/components/ui/FridayConfirmDialog.vue'
import ClipboardSecret from './ClipboardSecret.vue'
import ClipboardImage from './ClipboardImage.vue'
import ClipboardAsset from './ClipboardAsset.vue'
import ClipboardFiles from './ClipboardFiles.vue'
import ClipboardFileActions from './ClipboardFileActions.vue'
import ClipboardOrganize from './ClipboardOrganize.vue'
import ClipboardRichText from './ClipboardRichText.vue'
import ClipboardDetailDialog from './ClipboardDetailDialog.vue'
import ClipboardQrDialog from './ClipboardQrDialog.vue'
import ClipboardContextMenu from './ClipboardContextMenu.vue'
import { electronService } from '@/services/electron'
import { setI18nLanguage } from '@/i18n'
import { useTheme } from '@/utils/theme'
import { clipboardRichContent } from '@/utils/clipboardRichContent'
const { t } = useI18n()
const aiError = code => t('clipboard.aiErrors.' + code, t('clipboard.aiFailed'))
const item = ref(null), expanded = ref(false), error = ref(''), thumbnail = ref(''), showDetail = ref(false), showQr = ref(false), confirmSecret = ref(false), copied = ref(false)
const fileActionItem = ref(null), fileActionMode = ref('open'), showOrganize = ref(false), editingPhrase = ref(false), groups = ref({ categories: [], tags: [] })
const menuItem = ref(null), menuPosition = ref({ x: 0, y: 0 })
let unlisten, feedbackTimer, alive = true, refreshRequest = 0
const imagePaths = computed(() => item.value?.imagePaths?.length ? item.value.imagePaths : item.value?.imagePath ? [item.value.imagePath] : [])
const richHtml = computed(() => clipboardRichContent(item.value))
const mediaFiles = computed(() => (item.value?.filePaths || []).flatMap((name, index) => /\.(mp3|wav|ogg|m4a|aac|flac|opus|wma|mp4|webm|mov|mkv|avi|m4v|wmv)$/i.test(name) ? [{ name, index }] : []))
async function refresh() {
  const request = ++refreshRequest
  try {
    const state = await electronService.request('clipboard-pin-state')
    if (!alive || request !== refreshRequest || !state) return
    item.value = state.item; expanded.value = state.expanded; thumbnail.value = ''
    if (menuItem.value) menuItem.value = { ...state.item, targetFileIndex: menuItem.value.targetFileIndex }
    const imageFile = item.value.fileEntries?.find(entry => entry.kind === 'image')
    if ((imagePaths.value.length || imageFile) && item.value.sensitivity !== 'secret') {
      const image = await electronService.getClipboardImage(item.value.id, imagePaths.value.length ? {} : { fileIndex: imageFile.index })
      if (alive && request === refreshRequest) thumbnail.value = image.dataUrl
    }
  } catch { if (alive && request === refreshRequest) error.value = t('clipboard.assetUnavailable') }
}
async function setExpanded(value) { try { await electronService.request('clipboard-pin-mode', { expanded: value }); expanded.value = value } catch { error.value = t('clipboard.pinFailed') } }
async function close() { await electronService.request('clipboard-pin-close') }
async function detail() { await setExpanded(true); showDetail.value = true }
async function qr() { await setExpanded(true); showDetail.value = false; showQr.value = true }
function copy() { if (item.value.sensitivity === 'secret') { confirmSecret.value = true; setExpanded(true) } else copyConfirmed() }
async function copyConfirmed() {
  confirmSecret.value = false
  try { await electronService.request('clipboard-use', { id: item.value.id, confirmSensitive: item.value.sensitivity === 'secret' }); copied.value = true; clearTimeout(feedbackTimer); feedbackTimer = setTimeout(() => { copied.value = false }, 2000) }
  catch { error.value = t('clipboard.useFailed') }
}
async function openMenu(event, target) { if (!expanded.value) await setExpanded(true); menuPosition.value = { x: event.clientX || 10, y: event.clientY || 50 }; menuItem.value = target || item.value }
async function menuAction(action) {
  const target = menuItem.value || item.value
  menuItem.value = null
  if (action === 'copy') return copy()
  if (action === 'desktop-pin') return
  if (['open-file', 'open-folder'].includes(action)) {
    const mode = action === 'open-file' ? 'open' : 'folder'
    if (target.filePaths.length > 1 && !Number.isInteger(target.targetFileIndex)) { fileActionItem.value = target; fileActionMode.value = mode; return }
    try { await electronService.request('clipboard-file-open', { id: target.id, index: target.targetFileIndex ?? 0, mode }) } catch { error.value = t('clipboard.fileOpenFailed') }
    return
  }
  if (action === 'qr') return qr()
  if (action === 'preview') return detail()
  if (['organize', 'edit'].includes(action)) {
    try { groups.value = await electronService.getClipboardOrganization(); editingPhrase.value = action === 'edit'; showDetail.value = false; showOrganize.value = true } catch { error.value = t('clipboard.organizeFailed') }
    return
  }
  try {
    if (['path', 'text'].includes(action)) await electronService.request('clipboard-use', { id: item.value.id, mode: action, index: target.targetFileIndex })
    else if (['pin', 'favorite', 'phrase'].includes(action)) { const key = action === 'pin' ? 'pinned' : action; await electronService.request('clipboard-update', { id: item.value.id, [key]: !item.value[key] }) }
    else if (action === 'note') { const result = await electronService.saveClipboardToNote(item.value.id); await electronService.openClipboardNote(result.noteId) }
    else if (action === 'ai') { const result = await electronService.analyzeClipboardItem(item.value.id); if (result.code) error.value = aiError(result.code) }
    else if (action === 'delete') await electronService.request('clipboard-delete', { ids: [item.value.id] })
    await refresh()
  } catch { error.value = t('clipboard.editFailed') }
}
onMounted(async () => {
  useTheme().initTheme()
  const config = await electronService.request('get-config').catch(() => null)
  if (config?.language) setI18nLanguage(config.language)
  unlisten = electronService.listen('clipboard-pin-changed', refresh)
  await refresh()
})
onUnmounted(() => { alive = false; unlisten?.(); clearTimeout(feedbackTimer) })
</script>
<style scoped>
.clipboard-pinned{height:100vh;display:flex;flex-direction:column;box-sizing:border-box;background:var(--bg-primary);border:1px solid var(--border-color);border-radius:10px;color:var(--text-primary);overflow:hidden}.pin-title{height:40px;min-height:40px;display:flex;align-items:center;justify-content:space-between;padding:0 10px 0 14px;border-bottom:1px solid var(--border-color);font-size:12px;font-weight:600;-webkit-app-region:drag}.pin-title>div{display:flex;gap:3px;-webkit-app-region:no-drag}main{flex:1;min-height:0;overflow:auto;padding:12px;user-select:text}.compact-text,.expanded-text{white-space:pre-wrap;overflow-wrap:anywhere;margin:0;font:inherit;font-size:13px;line-height:1.6}.compact-text{max-height:60px;overflow:hidden}.pin-meta{font-size:11px;color:var(--text-tertiary);margin:8px 0 0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.pin-thumbnail{display:block;border:0;padding:0;background:transparent;cursor:zoom-in}.pin-thumbnail img{max-width:100%;max-height:65px;border-radius:4px}.pin-images{display:flex;flex-wrap:wrap;gap:8px}footer{display:flex;align-items:center;gap:6px;padding:6px 10px;border-top:1px solid var(--border-color);flex-shrink:0}footer span,.memo{font-size:12px;color:var(--text-secondary)}
</style>
