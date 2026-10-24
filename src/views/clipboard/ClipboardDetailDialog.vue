<template>
  <FridayDialog :visible="visible" :title="t('clipboard.detailTitle')" wide :close-label="t('clipboard.close')" @close="close">
    <div v-if="item" @contextmenu="contextMenu">
      <FridayNotice v-if="error" error>{{ error }}</FridayNotice>
      <div class="detail-meta"><span>{{ t('clipboard.' + item.kind, item.kind) }}</span><time>{{ formatTime(item.capturedAt) }}</time><span>{{ t('clipboard.source') }}: {{ sourceLabel(item.sourceApp) }}</span><span v-if="item.category">{{ item.category }}</span><span v-for="tag in item.tags" :key="tag">#{{ tag }}</span></div>
      <ClipboardSecret v-if="item.sensitivity === 'secret'" :key="item.id" :item="item" />
      <template v-else>
        <div v-if="item.imagePaths?.length" class="detail-images"><ClipboardImage v-for="(_, index) in item.imagePaths" :key="item.id + '-' + index" :item-id="item.id" :index="index" :revision="item.hash" @saved="$emit('changed', $event)" /></div>
        <ClipboardImage v-else-if="item.imagePath" :item-id="item.id" :revision="item.hash" @saved="$emit('changed', $event)" />
        <ClipboardAsset v-for="asset in fileAssets" :key="item.id + '-file-' + asset.index" :item-id="item.id" :index="asset.index" :name="asset.name" @code="fileCode = $event" />
        <ClipboardRichText v-if="richHtml" :key="item.id" ref="richEditor" :item-id="item.id" :html="richHtml" :editable="editing" @image-saved="$emit('changed', $event)" @edit="startEdit" />
        <template v-else-if="!editing">
          <a v-if="item.kind === 'link'" class="detail-link" :href="bodyText" @click.prevent="scheduleOpen" @dblclick.prevent="startEdit">{{ bodyText }}</a>
          <pre v-else-if="bodyText" class="detail-text" :class="{ code: isCode }" @dblclick="startEdit"><code v-if="isCode" v-html="highlightedCode" /><template v-else>{{ bodyText }}</template></pre>
        </template>
        <textarea v-else ref="editor" v-model="editText" class="detail-editor" :class="{ code: isCode }" :aria-label="t('clipboard.editContent')" :spellcheck="!isCode" @keydown.ctrl.enter.prevent="saveEdit" @keydown.meta.enter.prevent="saveEdit" @keydown.tab.prevent="insertTab" @keydown.esc.stop="editing = false" />
        <div v-if="canEdit" class="edit-actions">
          <template v-if="editing"><FridayButton compact :disabled="saving" variant="primary" @click="saveEdit">{{ t(saving ? 'clipboard.saving' : 'clipboard.saveSettings') }}</FridayButton><FridayButton compact :disabled="saving" @click="editing = false">{{ t('clipboard.cancel') }}</FridayButton></template>
          <FridayButton v-else compact @click="startEdit"><Pencil :size="14" />{{ t('clipboard.editContent') }}</FridayButton>
          <span v-if="isCode">{{ t('clipboard.codeEditHint') }}</span>
        </div>
        <ClipboardFiles v-if="item.filePaths?.length" :item="item" @contextmenu="(event, target) => $emit('contextmenu', event, target)" @changed="$emit('changed', $event)" />
        <div v-if="item.parts?.length" class="detail-parts"><article v-for="(part, index) in item.parts" :key="index"><strong>{{ t('clipboard.part', { count: index + 1 }) }} · {{ sourceLabel(part.sourceApp) }} · {{ formatTime(part.capturedAt) }}</strong><pre>{{ part.text || part.filePaths?.join('\\n') || t('clipboard.image') }}</pre></article></div>
      </template>
      <label class="memo-field"><span>{{ t('clipboard.memo') }}</span><textarea v-model="noteText" maxlength="2000" rows="3" :placeholder="t('clipboard.memoHint')" :disabled="noteSaving" @blur="saveMemo" /></label>
      <span v-if="noteSaved" class="saved-feedback" role="status">{{ t('clipboard.saved') }}</span>
    </div>
    <template #footer><FridayButton v-if="item" compact @click="$emit('copy', item)"><Copy :size="14" />{{ t(item.filePaths?.length ? 'clipboard.copyFile' : 'clipboard.copy') }}</FridayButton><FridayButton @click="close">{{ t('clipboard.close') }}</FridayButton></template>
  </FridayDialog>
</template>
<script setup>
import { computed, nextTick, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Copy, Pencil } from 'lucide-vue-next'
import hljs from 'highlight.js/lib/common'
import FridayButton from '@/components/ui/FridayButton.vue'
import FridayDialog from '@/components/ui/FridayDialog.vue'
import FridayNotice from '@/components/ui/FridayNotice.vue'
import ClipboardImage from './ClipboardImage.vue'
import ClipboardFiles from './ClipboardFiles.vue'
import ClipboardAsset from './ClipboardAsset.vue'
import ClipboardSecret from './ClipboardSecret.vue'
import ClipboardRichText from './ClipboardRichText.vue'
import { electronService } from '@/services/electron'
import { clipboardRichContent } from '@/utils/clipboardRichContent'
const props = defineProps({ visible: Boolean, item: Object })
const emit = defineEmits(['close', 'qr', 'copy', 'contextmenu', 'changed'])
const { t } = useI18n()
const editing = ref(false), editText = ref(''), editor = ref(null), richEditor = ref(null), saving = ref(false), error = ref('')
const noteText = ref(''), noteSaving = ref(false), noteSaved = ref(false), fileCode = ref(null)
let linkTimer
const isCode = computed(() => props.item?.kind === 'code')
const richHtml = computed(() => clipboardRichContent(props.item))
const canEdit = computed(() => ['text', 'html', 'link', 'code', 'mixed'].includes(props.item?.kind) && props.item?.sensitivity !== 'secret' && !props.item?.parts?.length && (!isCode.value || Boolean(bodyText.value)))
const bodyText = computed(() => props.item?.sensitivity === 'secret' ? '' : fileCode.value?.text ?? props.item?.plainText ?? '')
const highlightedCode = computed(() => {
  const text = bodyText.value
  const language = fileCode.value?.language || props.item?.language
  if (text.length <= 100000 && language && hljs.getLanguage(language)) return hljs.highlight(text, { language, ignoreIllegals: true }).value
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
})
const fileAssets = computed(() => {
  if (props.item?.sensitivity === 'secret') return []
  return (props.item?.filePaths || []).flatMap((name, index) => /\.(mp3|wav|ogg|m4a|aac|flac|opus|wma|mp4|webm|mov|mkv|avi|m4v|wmv)$/i.test(name) || (isCode.value && index === 0) ? [{ name, index }] : [])
})
const formatTime = value => value ? new Date(value).toLocaleString() : ''
const sourceLabel = value => value === 'friday-merge' ? t('clipboard.sourceMerge') : value === 'screen-recording' ? t('clipboard.sourceRecording') : value === 'friday-phrase' ? t('clipboard.sourcePhrase') : value === 'system-clipboard' ? t('clipboard.sourceSystem') : (value || t('clipboard.sourceUnknown'))
watch(() => [props.visible, props.item?.id], ([visible]) => { clearTimeout(linkTimer); editing.value = false; fileCode.value = null; error.value = ''; noteSaved.value = false; if (visible) noteText.value = props.item?.note || '' })
function contextMenu(event) {
  if (event.target.closest('textarea, input, [contenteditable="true"]')) return
  event.preventDefault()
  emit('contextmenu', event, props.item)
}
async function startEdit() {
  clearTimeout(linkTimer)
  if (!canEdit.value || saving.value) return
  editText.value = bodyText.value; editing.value = true; error.value = ''
  await nextTick(); editor.value?.focus()
}
function insertTab(event) {
  const input = event.target, start = input.selectionStart, end = input.selectionEnd
  editText.value = editText.value.slice(0, start) + '  ' + editText.value.slice(end)
  nextTick(() => { input.selectionStart = input.selectionEnd = start + 2 })
}
async function saveEdit() {
  if (!editing.value || saving.value || !props.item) return
  const id = props.item.id
  const patch = richHtml.value ? richEditor.value.value() : { plainText: editText.value }
  saving.value = true; error.value = ''
  try {
    const updated = await electronService.request('clipboard-update', { id, ...patch, editContent: true })
    if (props.item?.id === id) { editing.value = false; fileCode.value = null; emit('changed', updated) }
  } catch { error.value = t('clipboard.editFailed') }
  finally { saving.value = false }
}
function scheduleOpen() { clearTimeout(linkTimer); linkTimer = setTimeout(async () => { try { await electronService.openClipboardLink(props.item.id) } catch { error.value = t('clipboard.linkFailed') } }, 350) }
async function saveMemo() {
  if (!props.item || noteSaving.value || noteText.value === (props.item.note || '')) return
  const id = props.item.id
  noteSaving.value = true; error.value = ''; noteSaved.value = false
  try { const updated = await electronService.request('clipboard-update', { id, note: noteText.value }); if (props.item?.id === id) { emit('changed', updated); noteSaved.value = true } }
  catch { error.value = t('clipboard.memoFailed') }
  finally { noteSaving.value = false }
}
function close() { if (saving.value || noteSaving.value) return; editing.value = false; clearTimeout(linkTimer); emit('close') }
onUnmounted(() => clearTimeout(linkTimer))
</script>
<style scoped>
.detail-meta{display:flex;gap:10px;align-items:center;flex-wrap:wrap;color:var(--text-tertiary);font-size:12px;margin-bottom:14px}.detail-images{display:flex;gap:12px;flex-wrap:wrap;margin-bottom:14px}.detail-text{max-height:52vh;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;margin:0;padding:16px;border-radius:8px;background:var(--bg-secondary);color:var(--text-primary);font:inherit;font-size:13px;line-height:1.7;user-select:text}.code{font-family:Consolas,'Courier New',monospace;tab-size:2;white-space:pre;overflow-wrap:normal}.detail-editor{width:100%;min-height:280px;box-sizing:border-box;padding:16px;border:1px solid var(--border-color);border-radius:8px;background:var(--bg-secondary);color:var(--text-primary);font-size:13px;line-height:1.7;resize:vertical;outline:none}.detail-editor:focus{border-color:var(--text-tertiary)}.edit-actions{display:flex;align-items:center;gap:8px;margin-top:10px;flex-wrap:wrap}.edit-actions span{font-size:12px;color:var(--text-tertiary)}.detail-link{display:block;overflow-wrap:anywhere;line-height:1.7;color:var(--accent-color);user-select:text}.memo-field{display:flex;flex-direction:column;gap:8px;margin-top:16px;color:var(--text-secondary);font-size:13px}.memo-field textarea{width:100%;box-sizing:border-box;min-height:78px;padding:10px;border:1px solid var(--border-color);border-radius:8px;background:var(--bg-secondary);color:var(--text-primary);font:inherit;resize:vertical}.detail-files{max-height:38vh;overflow:auto;margin:14px 0 0;padding:12px 12px 12px 30px;border-radius:8px;background:var(--bg-secondary);color:var(--text-primary);font-size:13px;line-height:1.7;overflow-wrap:anywhere}.detail-parts{display:flex;flex-direction:column;gap:12px;margin-top:14px}.detail-parts article{padding:12px;border-radius:8px;background:var(--bg-secondary)}.detail-parts strong{font-size:12px;color:var(--text-tertiary)}.detail-parts pre{white-space:pre-wrap;overflow-wrap:anywhere;margin:6px 0 0;font:inherit;font-size:13px;line-height:1.6}.saved-feedback{font-size:12px;color:var(--text-tertiary)}.detail-text :deep(.hljs-keyword),.detail-text :deep(.hljs-built_in){color:var(--accent-color)}.detail-text :deep(.hljs-string){color:#3c8056}.detail-text :deep(.hljs-comment){color:var(--text-tertiary)}
</style>
