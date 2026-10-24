<template>
  <div ref="root" class="image-entry">
    <button v-if="thumb" class="thumbnail" type="button" :aria-label="t('clipboard.openImage')" @click="openPreview"><img :src="thumb.dataUrl" :alt="t('clipboard.image')" @error="thumb = null; thumbError = t('clipboard.imageInvalid')" /><span class="image-hint"><Expand :size="13" />{{ t('clipboard.openImage') }}</span></button>
    <div v-else class="image-placeholder" :role="thumbError ? 'alert' : 'status'"><ImageOff v-if="thumbError" :size="22" /><LoaderCircle v-else :size="22" class="spin" /><span>{{ thumbError || t('clipboard.imageLoading') }}</span><FridayButton v-if="thumbError" compact @click="allowExternal = true; loadThumbnail()">{{ t(externalRequired ? 'clipboard.loadExternalImage' : 'clipboard.retry') }}</FridayButton></div>
    <FridayDialog :visible="visible && !editing" wide :title="t('clipboard.imagePreview')" :close-label="t('clipboard.close')" @close="closePreview">
      <div v-if="fullLoading || fullError" class="preview-status" :role="fullError ? 'alert' : 'status'"><LoaderCircle v-if="fullLoading" class="spin" :size="26" /><span>{{ fullError || t('clipboard.imageLoading') }}</span><FridayButton v-if="fullError" @click="loadFull">{{ t('clipboard.retry') }}</FridayButton></div>
      <div v-else-if="full" ref="canvas" class="preview-canvas" :class="{ original, dragging: drag.active }" tabindex="0" :aria-label="t('clipboard.imagePreview')" @wheel.prevent="zoomImage" @pointerdown="startDrag" @pointermove="moveDrag" @pointerup="endDrag" @pointercancel="endDrag" @pointerleave="endDrag"><img :src="full.dataUrl" :style="imageStyle" :alt="t('clipboard.image')" draggable="false" @error="fullError = t('clipboard.imageInvalid')" /></div>
      <template #footer><span v-if="full" class="dimensions">{{ full.width }} × {{ full.height }} px · {{ Math.round(zoom * 100) }}%</span><FridayButton :disabled="!full || fullLoading" @click="fitImage">{{ t('clipboard.fitImage') }}</FridayButton><FridayButton :disabled="!full || fullLoading" @click="toggleOriginal">{{ original ? t('clipboard.fitImage') : t('clipboard.originalImage') }}</FridayButton><FridayButton :disabled="!full || fullLoading || editDisabled" :title="editDisabled ? t('clipboard.saveRichTextBeforeImage') : ''" @click="editing = true">{{ t('clipboard.editImage') }}</FridayButton><FridayButton @click="closePreview">{{ t('clipboard.close') }}</FridayButton></template>
    </FridayDialog>
    <ClipboardImageEditor :visible="editing" :image="full" :item-id="itemId" :index="index" :file-index="fileIndex" :html-index="htmlIndex" @close="editing = false" @saved="imageSaved" />
  </div>
</template>
<script setup>
import { computed, onBeforeUnmount, onDeactivated, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Expand, ImageOff, LoaderCircle } from 'lucide-vue-next'
import FridayButton from '@/components/ui/FridayButton.vue'
import FridayDialog from '@/components/ui/FridayDialog.vue'
import ClipboardImageEditor from './ClipboardImageEditor.vue'
import { electronService } from '@/services/electron'
const props = defineProps({ itemId: { type: String, required: true }, index: { type: Number, default: 0 }, fileIndex: { type: Number, default: undefined }, htmlIndex: { type: Number, default: undefined }, revision: String, editDisabled: Boolean })
const emit = defineEmits(['saved'])
const { t } = useI18n()
const root = ref(null), thumb = ref(null), thumbError = ref('')
const allowExternal = ref(false), externalRequired = ref(false), canvasSize = ref({ width: 1, height: 1 })
const editing = ref(false), visible = ref(false), full = ref(null), fullLoading = ref(false), fullError = ref(''), original = ref(false), zoom = ref(1)
const canvas = ref(null), drag = ref({ active: false, pointerId: null, x: 0, y: 0, startX: 0, startY: 0 })
let observer, resizeObserver, disposed = false, fullRequest = 0, thumbnailRequest = 0
function imageError(error) {
  const code = ['CLIPBOARD_IMAGE_EXTERNAL_REQUIRED', 'CLIPBOARD_IMAGE_LOAD_FAILED', 'CLIPBOARD_IMAGE_MISSING', 'CLIPBOARD_IMAGE_TOO_LARGE', 'CLIPBOARD_IMAGE_UNAVAILABLE'].find(code => error.code === code || error.message?.includes(code))
  externalRequired.value = code === 'CLIPBOARD_IMAGE_EXTERNAL_REQUIRED'
  return t(({ CLIPBOARD_IMAGE_EXTERNAL_REQUIRED: 'clipboard.externalImageHint', CLIPBOARD_IMAGE_LOAD_FAILED: 'clipboard.externalImageFailed', CLIPBOARD_IMAGE_MISSING: 'clipboard.imageMissing', CLIPBOARD_IMAGE_TOO_LARGE: 'clipboard.imageTooLarge', CLIPBOARD_IMAGE_UNAVAILABLE: 'clipboard.imageUnavailable' })[code] || 'clipboard.imageInvalid')
}
async function loadThumbnail() {
  const current = ++thumbnailRequest
  thumbError.value = ''; externalRequired.value = false
  try { const result = await electronService.getClipboardImage(props.itemId, { index: props.index, fileIndex: props.fileIndex, htmlIndex: props.htmlIndex, loadExternal: allowExternal.value }); if (!disposed && current === thumbnailRequest) thumb.value = result }
  catch (error) { if (!disposed && current === thumbnailRequest) thumbError.value = imageError(error) }
}
async function loadFull() {
  const current = ++fullRequest
  fullLoading.value = true; fullError.value = ''
  try { const result = await electronService.getClipboardImage(props.itemId, { index: props.index, fileIndex: props.fileIndex, htmlIndex: props.htmlIndex, loadExternal: allowExternal.value, thumbnail: false }); if (current === fullRequest && !disposed) full.value = result }
  catch (error) { if (current === fullRequest && !disposed) fullError.value = imageError(error) }
  finally { if (current === fullRequest) fullLoading.value = false }
}
const imageStyle = computed(() => {
  if (!full.value) return undefined
  return { width: displaySize.value.width + 'px', height: displaySize.value.height + 'px', transform: 'translate(' + drag.value.x + 'px, ' + drag.value.y + 'px) scale(' + zoom.value + ')', transformOrigin: 'center center' }
})
const displaySize = computed(() => {
  if (!full.value) return { width: 1, height: 1 }
  const scale = original.value ? 1 : Math.min(1, canvasSize.value.width / full.value.width, canvasSize.value.height / full.value.height)
  return { width: full.value.width * scale, height: full.value.height * scale }
})
function clampPan(x, y, scale = zoom.value) {
  // 始终保留图片与画布重叠，避免拖走后无法找回。
  const limitX = Math.max(0, (displaySize.value.width * scale - canvasSize.value.width) / 2)
  const limitY = Math.max(0, (displaySize.value.height * scale - canvasSize.value.height) / 2)
  return { x: Math.max(-limitX, Math.min(limitX, x)), y: Math.max(-limitY, Math.min(limitY, y)) }
}
watch(canvas, element => {
  resizeObserver?.disconnect()
  if (!element) return
  resizeObserver = new ResizeObserver(() => { canvasSize.value = { width: element.clientWidth, height: element.clientHeight }; drag.value = { ...drag.value, ...clampPan(drag.value.x, drag.value.y) } })
  resizeObserver.observe(element)
})
function openPreview() { visible.value = true; original.value = false; zoom.value = 1; drag.value = { ...drag.value, x: 0, y: 0 }; loadFull() }
function fitImage() { original.value = false; zoom.value = 1; drag.value = { ...drag.value, x: 0, y: 0 } }
function toggleOriginal() { original.value = !original.value; zoom.value = 1; drag.value = { ...drag.value, x: 0, y: 0 } }
function zoomImage(event) {
  if (!full.value) return
  const next = Math.max(0.5, Math.min(4, Number((zoom.value + (event.deltaY < 0 ? 0.2 : -0.2)).toFixed(2))))
  const rect = canvas.value.getBoundingClientRect(), ratio = next / zoom.value
  const x = event.clientX - rect.left - rect.width / 2, y = event.clientY - rect.top - rect.height / 2
  drag.value = { ...drag.value, ...clampPan(x - (x - drag.value.x) * ratio, y - (y - drag.value.y) * ratio, next) }
  zoom.value = next
}
function startDrag(event) {
  if (!full.value || event.button !== 0 ) return
  drag.value = { ...drag.value, active: true, pointerId: event.pointerId, startX: event.clientX - drag.value.x, startY: event.clientY - drag.value.y }
  canvas.value?.setPointerCapture?.(event.pointerId)
}
function moveDrag(event) {
  if (!drag.value.active || drag.value.pointerId !== event.pointerId) return
  drag.value = { ...drag.value, ...clampPan(event.clientX - drag.value.startX, event.clientY - drag.value.startY) }
}
function endDrag(event) {
  if (drag.value.active && (event?.pointerId === undefined || drag.value.pointerId === event.pointerId)) {
    canvas.value?.releasePointerCapture?.(drag.value.pointerId)
    drag.value = { ...drag.value, active: false, pointerId: null }
  }
}
async function imageSaved(item) { emit('saved', item); await Promise.all([loadThumbnail(), loadFull()]); fitImage() }
watch(() => [props.itemId, props.index, props.fileIndex, props.htmlIndex, props.revision], () => { loadThumbnail(); if (visible.value && !editing.value) loadFull() })
defineExpose({ openPreview })
function closePreview() { editing.value = false; visible.value = false; full.value = null; fullRequest++; original.value = false; zoom.value = 1; endDrag({}) }
onMounted(() => {
  observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) { observer.disconnect(); loadThumbnail() } }, { rootMargin: '160px' })
  observer.observe(root.value)
})
onDeactivated(closePreview)
onBeforeUnmount(() => { disposed = true; thumbnailRequest++; observer?.disconnect(); resizeObserver?.disconnect(); closePreview() })
</script>
<style scoped>
.thumbnail{display:flex;position:relative;padding:0;max-width:100%;border:1px solid var(--border-color);border-radius:7px;background:var(--bg-secondary);overflow:hidden;cursor:zoom-in}.thumbnail img{display:block;max-width:min(260px,100%);max-height:144px;object-fit:contain}.image-hint{position:absolute;bottom:0;left:0;right:0;display:flex;justify-content:center;align-items:center;gap:5px;padding:5px;background:var(--bg-primary);color:var(--text-secondary);font-size:11px;opacity:0;transition:opacity .15s}.thumbnail:hover .image-hint,.thumbnail:focus-visible .image-hint{opacity:.94}.thumbnail:focus-visible{outline:2px solid var(--accent-color);outline-offset:3px}.image-placeholder{display:flex;align-items:center;gap:9px;min-height:86px;color:var(--text-tertiary);font-size:12px;flex-wrap:wrap}.preview-status{min-height:200px;display:flex;align-items:center;justify-content:center;gap:12px;flex-direction:column;color:var(--text-secondary);font-size:13px}.preview-canvas{display:flex;justify-content:center;align-items:center;height:clamp(140px,55vh,640px);min-height:120px;overflow:hidden;background:var(--bg-secondary);border-radius:6px;cursor:zoom-in;touch-action:none}.preview-canvas.dragging{cursor:grabbing}.preview-canvas img{display:block;flex:none;max-width:none;max-height:none;object-fit:contain;user-select:none;-webkit-user-drag:none;transition:transform .12s ease-out}.preview-canvas.dragging img{transition:none}.preview-canvas.original{cursor:grab}.preview-canvas.original img{max-width:none;max-height:none}.dimensions{margin-right:auto;color:var(--text-tertiary);font-size:12px}.spin{animation:spin .7s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}
</style>
