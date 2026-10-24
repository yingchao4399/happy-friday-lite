<template>
  <FridayDialog :visible="visible" wide :title="t('clipboard.editImage')" :close-label="t('clipboard.close')" @close="!saving && $emit('close')">
    <FridayNotice v-if="error" error>{{ error }}</FridayNotice>
    <div class="image-tools">
      <FridayButton v-for="tool in tools" :key="tool.key" compact :variant="mode === tool.key ? 'primary' : 'secondary'" :disabled="saving || !ready" :aria-pressed="mode === tool.key" @click="chooseTool(tool.key)"><component :is="tool.icon" :size="14" />{{ t('clipboard.' + tool.key) }}</FridayButton>
      <label>{{ t('clipboard.color') }}<input v-model="color" type="color" :disabled="saving" /></label>
      <label>{{ t(mode === 'textBox' ? 'clipboard.fontSize' : 'clipboard.strokeWidth') }}<input v-model.number="size" type="number" min="1" max="160" :disabled="saving" /></label>
      <FridayButton compact :disabled="saving || !ready" @click="rotate"><RotateCw :size="14" />{{ t('clipboard.rotateImage') }}</FridayButton>
      <FridayButton compact :disabled="saving || historyIndex <= 0" @click="undo"><Undo2 :size="14" />{{ t('clipboard.undo') }}</FridayButton>
      <FridayButton compact :disabled="saving || historyIndex >= historyCount - 1" @click="redo"><Redo2 :size="14" />{{ t('clipboard.redo') }}</FridayButton>
    </div>
    <p class="tool-hint">{{ t('clipboard.imageToolHints.' + mode) }}</p>
    <div class="editing-stage">
      <div class="canvas-wrap">
        <canvas ref="canvas" :aria-label="t('clipboard.editImage')" @pointerdown="pointerDown" @pointermove="pointerMove" @pointerup="pointerUp" @pointercancel="pointerCancel" />
        <div v-if="selection" class="crop-selection" :style="selectionStyle" />
        <textarea v-if="textBox" ref="textInput" v-model="textValue" class="text-overlay" :style="{ left: textBox.x / canvas.width * 100 + '%', top: textBox.y / canvas.height * 100 + '%', color }" :aria-label="t('clipboard.textBox')" :placeholder="t('clipboard.textPlaceholder')" @keydown.ctrl.enter.prevent="applyText" />
      </div>
    </div>
    <div class="edit-options"><FridayButton v-if="mode === 'cropImage'" compact :disabled="!selection || saving" @click="applyCrop">{{ t('clipboard.applyCrop') }}</FridayButton><FridayButton v-if="textBox" compact :disabled="!textValue.trim() || saving" @click="applyText">{{ t('clipboard.applyText') }}</FridayButton><FridayButton v-if="selection || textBox" compact variant="text" @click="clearSelection">{{ t('clipboard.cancel') }}</FridayButton><span v-if="ready">{{ dimensions.width }} × {{ dimensions.height }} px</span></div>
    <template #footer><FridayButton :disabled="saving" @click="$emit('close')">{{ t('clipboard.cancel') }}</FridayButton><FridayButton variant="primary" :disabled="saving || !ready || (!dirty && !textValue.trim())" @click="save">{{ t(saving ? 'clipboard.saving' : 'clipboard.saveImage') }}</FridayButton></template>
  </FridayDialog>
</template>
<script setup>
import { computed, nextTick, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Crop, Grid2X2, PenLine, Redo2, RotateCw, Type, Undo2 } from 'lucide-vue-next'
import FridayDialog from '@/components/ui/FridayDialog.vue'
import FridayButton from '@/components/ui/FridayButton.vue'
import FridayNotice from '@/components/ui/FridayNotice.vue'
import { electronService } from '@/services/electron'
const props = defineProps({ visible: Boolean, image: Object, itemId: String, index: Number, fileIndex: Number, htmlIndex: Number })
const emit = defineEmits(['close', 'saved'])
const { t } = useI18n()
const canvas = ref(null), textInput = ref(null), ready = ref(false), saving = ref(false), error = ref('')
const mode = ref('pen'), color = ref('#e53935'), size = ref(6), selection = ref(null), textBox = ref(null), textValue = ref('')
const dimensions = ref({ width: 0, height: 0 }), dirty = ref(false), historyIndex = ref(-1), historyCount = ref(0)
const tools = [{ key: 'pen', icon: PenLine }, { key: 'textBox', icon: Type }, { key: 'cropImage', icon: Crop }, { key: 'mosaic', icon: Grid2X2 }]
let history = [], drawing = null, sequence = 0, request = 0
const selectionStyle = computed(() => selection.value ? { left: selection.value.x / dimensions.value.width * 100 + '%', top: selection.value.y / dimensions.value.height * 100 + '%', width: selection.value.width / dimensions.value.width * 100 + '%', height: selection.value.height / dimensions.value.height * 100 + '%' } : {})
function context() { return canvas.value?.getContext('2d', { willReadFrequently: true }) }
function snapshot(initial = false) {
  const image = context().getImageData(0, 0, canvas.value.width, canvas.value.height)
  history = history.slice(0, historyIndex.value + 1)
  history.push({ image, id: initial ? 0 : ++sequence })
  let bytes = history.reduce((sum, entry) => sum + entry.image.data.byteLength, 0)
  while (history.length > 2 && (history.length > 20 || bytes > 96 * 1024 * 1024)) bytes -= history.shift().image.data.byteLength
  historyIndex.value = history.length - 1; historyCount.value = history.length; dirty.value = history.at(-1).id !== 0
  dimensions.value = { width: canvas.value.width, height: canvas.value.height }
}
function restore(index) {
  const entry = history[index]
  if (!entry) return
  clearSelection(); canvas.value.width = entry.image.width; canvas.value.height = entry.image.height
  context().putImageData(entry.image, 0, 0)
  historyIndex.value = index; dirty.value = entry.id !== 0
  dimensions.value = { width: canvas.value.width, height: canvas.value.height }
}
function undo() { restore(historyIndex.value - 1) }
function redo() { restore(historyIndex.value + 1) }
function clearSelection() { selection.value = null; textBox.value = null; textValue.value = ''; drawing = null }
function chooseTool(value) { clearSelection(); mode.value = value; size.value = value === 'textBox' ? Math.max(18, Math.min(48, Math.round(dimensions.value.width / 35))) : 6 }
function point(event) {
  const rect = canvas.value.getBoundingClientRect()
  return { x: Math.max(0, Math.min(canvas.value.width, (event.clientX - rect.left) * canvas.value.width / rect.width)), y: Math.max(0, Math.min(canvas.value.height, (event.clientY - rect.top) * canvas.value.height / rect.height)) }
}
function pointerDown(event) {
  if (!ready.value || saving.value || event.button !== 0) return
  const p = point(event)
  if (mode.value === 'textBox') { textBox.value = p; textValue.value = ''; nextTick(() => textInput.value?.focus()); return }
  canvas.value.setPointerCapture(event.pointerId)
  drawing = { start: p, last: p, pointerId: event.pointerId }
  if (mode.value === 'pen') {
    const ctx = context(); ctx.fillStyle = color.value; ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(1, Math.min(160, size.value || 6)) / 2, 0, Math.PI * 2); ctx.fill()
  } else selection.value = { x: p.x, y: p.y, width: 0, height: 0 }
}
function pointerMove(event) {
  if (!drawing || event.pointerId !== drawing.pointerId) return
  const p = point(event)
  if (mode.value === 'pen') {
    const ctx = context(); ctx.strokeStyle = color.value; ctx.lineWidth = Math.max(1, Math.min(160, size.value || 6)); ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.beginPath(); ctx.moveTo(drawing.last.x, drawing.last.y); ctx.lineTo(p.x, p.y); ctx.stroke()
  } else selection.value = { x: Math.floor(Math.min(p.x, drawing.start.x)), y: Math.floor(Math.min(p.y, drawing.start.y)), width: Math.floor(Math.abs(p.x - drawing.start.x)), height: Math.floor(Math.abs(p.y - drawing.start.y)) }
  drawing.last = p
}
function pointerUp(event) {
  if (!drawing || event.pointerId !== drawing.pointerId) return
  pointerMove(event)
  if (canvas.value.hasPointerCapture(event.pointerId)) canvas.value.releasePointerCapture(event.pointerId)
  drawing = null
  if (mode.value === 'pen') snapshot()
  if (mode.value === 'mosaic') applyMosaic()
}
function pointerCancel() { if (drawing && mode.value === 'pen') restore(historyIndex.value); drawing = null }
function applyMosaic() {
  const rect = selection.value
  if (!rect || rect.width < 2 || rect.height < 2) return
  const small = document.createElement('canvas'), block = Math.max(8, Math.round(dimensions.value.width / 80))
  small.width = Math.max(1, Math.ceil(rect.width / block)); small.height = Math.max(1, Math.ceil(rect.height / block))
  small.getContext('2d').drawImage(canvas.value, rect.x, rect.y, rect.width, rect.height, 0, 0, small.width, small.height)
  const ctx = context(); ctx.save(); ctx.imageSmoothingEnabled = false; ctx.drawImage(small, 0, 0, small.width, small.height, rect.x, rect.y, rect.width, rect.height); ctx.restore()
  selection.value = null; snapshot()
}
function applyCrop() {
  const rect = selection.value
  if (!rect || rect.width < 2 || rect.height < 2) return
  const cropped = context().getImageData(rect.x, rect.y, rect.width, rect.height)
  canvas.value.width = rect.width; canvas.value.height = rect.height; context().putImageData(cropped, 0, 0); clearSelection(); snapshot()
}
function rotate() {
  clearSelection()
  const source = document.createElement('canvas'); source.width = canvas.value.width; source.height = canvas.value.height
  source.getContext('2d').drawImage(canvas.value, 0, 0)
  canvas.value.width = source.height; canvas.value.height = source.width
  const ctx = context(); ctx.translate(canvas.value.width, 0); ctx.rotate(Math.PI / 2); ctx.drawImage(source, 0, 0); ctx.resetTransform(); snapshot()
}
function applyText() {
  if (!textBox.value || !textValue.value.trim()) return
  const ctx = context(), font = Math.max(1, Math.min(160, size.value || 24)), left = textBox.value.x, maxWidth = Math.max(font, canvas.value.width - left)
  ctx.fillStyle = color.value; ctx.font = font + 'px sans-serif'; ctx.textBaseline = 'top'
  let top = textBox.value.y
  for (const paragraph of textValue.value.split('\n')) {
    let line = ''
    for (const character of paragraph) {
      if (line && ctx.measureText(line + character).width > maxWidth) { ctx.fillText(line, left, top); top += font * 1.3; line = '' }
      line += character
    }
    ctx.fillText(line, left, top); top += font * 1.3
  }
  textBox.value = null; textValue.value = ''; snapshot()
}
async function save() {
  if (saving.value || !ready.value) return
  if (textValue.value.trim()) applyText()
  if (mode.value === 'cropImage' && selection.value?.width >= 2 && selection.value?.height >= 2) applyCrop()
  saving.value = true; error.value = ''
  try {
    const dataUrl = await new Promise((resolve, reject) => canvas.value.toBlob(blob => {
      if (!blob) { reject(new Error('CLIPBOARD_IMAGE_INVALID')); return }
      const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(blob)
    }, 'image/png'))
    const item = await electronService.request('clipboard-image-save', { id: props.itemId, index: props.index, fileIndex: props.fileIndex, htmlIndex: props.htmlIndex, dataUrl, baseHash: props.image.contentHash })
    emit('saved', item); emit('close')
  } catch (e) { error.value = t(e.message?.includes('CONFLICT') ? 'clipboard.imageEditConflict' : 'clipboard.imageSaveFailed') }
  finally { saving.value = false }
}
watch(() => props.visible, async visible => {
  const current = ++request
  history = []; historyIndex.value = -1; historyCount.value = 0; dirty.value = false; ready.value = false; error.value = ''; clearSelection()
  if (!visible) return
  if (!props.image || props.image.width * props.image.height > 8_000_000) { error.value = t('clipboard.imageEditTooLarge'); return }
  await nextTick()
  const image = new Image()
  image.onload = () => {
    if (current !== request || !canvas.value) return
    canvas.value.width = image.naturalWidth; canvas.value.height = image.naturalHeight; context().drawImage(image, 0, 0); sequence = 0; snapshot(true); ready.value = true
  }
  image.onerror = () => { error.value = t('clipboard.imageInvalid') }; image.src = props.image.dataUrl
}, { immediate: true })
onUnmounted(() => { request++; history = []; if (canvas.value) { canvas.value.width = 0; canvas.value.height = 0 } })
</script>
<style scoped>
.image-tools{display:flex;align-items:center;gap:7px;flex-wrap:wrap}.image-tools label{display:flex;align-items:center;gap:6px;color:var(--text-secondary);font-size:12px}.image-tools input[type=color]{width:30px;height:26px;border:1px solid var(--border-color);border-radius:5px;background:var(--bg-secondary)}.image-tools input[type=number]{width:54px;padding:4px;border:1px solid var(--border-color);border-radius:5px;background:var(--bg-secondary);color:var(--text-primary);font:inherit}.tool-hint{margin:10px 0;color:var(--text-tertiary);font-size:12px}.editing-stage{display:flex;justify-content:center;align-items:center;min-height:140px;overflow:auto;padding:8px;background:var(--bg-secondary);border-radius:8px}.canvas-wrap{position:relative;max-width:100%;width:fit-content}canvas{display:block;max-width:100%;max-height:50vh;width:auto;height:auto;touch-action:none;cursor:crosshair}.crop-selection{position:absolute;box-sizing:border-box;border:2px dashed var(--accent-color);background:rgba(80,120,200,.12);pointer-events:none}.text-overlay{position:absolute;min-width:90px;width:200px;max-width:70%;min-height:65px;padding:5px;border:1px dashed var(--accent-color);border-radius:4px;background:var(--bg-primary);font:inherit;font-size:16px;resize:both;z-index:1}.edit-options{display:flex;align-items:center;gap:8px;min-height:36px;margin-top:9px}.edit-options span{margin-left:auto;color:var(--text-tertiary);font-size:12px}
</style>
