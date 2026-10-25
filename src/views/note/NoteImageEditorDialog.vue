<template>
  <Teleport to="body">
    <Transition name="note-image-editor-fade">
      <div v-if="visible" class="note-image-editor-overlay" @click.self="close">
        <section class="note-image-editor" role="dialog" aria-modal="true" :aria-label="t('note.imageEditor.title')">
          <header class="note-image-editor-header">
            <div class="note-image-editor-title">
              <ImageIcon :size="17" :stroke-width="2" />
              <span>{{ t('note.imageEditor.title') }}</span>
            </div>
            <button class="image-editor-close" type="button" :aria-label="t('note.cancel')" @click="close">×</button>
          </header>

          <div class="note-image-editor-body">
            <div ref="stageRef" class="image-editor-stage" :class="{ panning: activeTool === 'pan', cropping: activeTool === 'crop' }" @wheel.prevent="handleWheel">
              <canvas
                ref="canvasRef"
                class="image-editor-canvas"
                :style="canvasStyle"
                @pointerdown="handlePointerDown"
                @pointermove="handlePointerMove"
                @pointerup="handlePointerUp"
                @pointercancel="handlePointerUp"
                @pointerleave="handlePointerLeave"
              />
              <div v-if="cropRect" class="crop-selection" :style="cropStyle"></div>
              <div v-if="loading" class="image-editor-loading">{{ t('note.imageEditor.loading') }}</div>
              <div v-if="loadError" class="image-editor-error">{{ loadError }}</div>
            </div>

            <aside class="image-editor-tools">
              <div class="image-editor-tool-group">
                <button type="button" class="image-editor-tool" :class="{ active: activeTool === 'pan' }" :title="t('note.imageEditor.pan')" @click="activeTool = 'pan'"><Move :size="16" /></button>
                <button type="button" class="image-editor-tool" :title="t('note.imageEditor.zoomOut')" @click="zoomBy(-0.1)"><ZoomOut :size="16" /></button>
                <span class="image-editor-zoom">{{ Math.round(zoom * 100) }}%</span>
                <button type="button" class="image-editor-tool" :title="t('note.imageEditor.zoomIn')" @click="zoomBy(0.1)"><ZoomIn :size="16" /></button>
              </div>
              <div class="image-editor-tool-group">
                <button type="button" class="image-editor-tool" :title="t('note.imageEditor.rotateLeft')" @click="rotate(-90)"><RotateCcw :size="16" /></button>
                <button type="button" class="image-editor-tool" :title="t('note.imageEditor.rotateRight')" @click="rotate(90)"><RotateCw :size="16" /></button>
                <button type="button" class="image-editor-tool" :class="{ active: activeTool === 'crop' }" :title="t('note.imageEditor.crop')" @click="toggleTool('crop')"><Crop :size="16" /></button>
                <button type="button" class="image-editor-tool" :title="t('note.imageEditor.reset')" @click="resetImage"><RefreshCw :size="16" /></button>
              </div>
              <div class="image-editor-tool-group image-editor-tool-group-label">
                <button type="button" class="image-editor-tool" :class="{ active: activeTool === 'draw' }" :title="t('note.imageEditor.draw')" @click="toggleTool('draw')"><PenLine :size="16" /></button>
                <button type="button" class="image-editor-tool" :class="{ active: activeTool === 'mosaic' }" :title="t('note.imageEditor.mosaic')" @click="toggleTool('mosaic')"><Grid2X2 :size="16" /></button>
                <button type="button" class="image-editor-tool" :class="{ active: activeTool === 'text' }" :title="t('note.imageEditor.text')" @click="toggleTool('text')"><Type :size="16" /></button>
              </div>

              <div v-if="activeTool === 'draw'" class="image-editor-option">
                <label>{{ t('note.imageEditor.strokeColor') }}<input v-model="strokeColor" type="color" /></label>
                <label>{{ t('note.imageEditor.strokeWidth') }}<input v-model.number="strokeWidth" type="range" min="1" max="24" /></label>
              </div>
              <div v-if="activeTool === 'text'" class="image-editor-option">
                <label>{{ t('note.imageEditor.textContent') }}<input v-model="textValue" type="text" :placeholder="t('note.imageEditor.textPlaceholder')" @keydown.enter.prevent="activeTool = 'text'" /></label>
                <label>{{ t('note.imageEditor.textColor') }}<input v-model="textColor" type="color" /></label>
              </div>
              <div class="image-editor-option image-editor-size">
                <label>{{ t('note.imageEditor.width') }}<input v-model.number="outputWidth" type="number" min="1" /></label>
                <span>×</span>
                <label>{{ t('note.imageEditor.height') }}<input v-model.number="outputHeight" type="number" min="1" /></label>
              </div>
              <p class="image-editor-hint">{{ t('note.imageEditor.hint') }}</p>
            </aside>
          </div>

          <footer class="note-image-editor-footer">
            <span v-if="dirty" class="image-editor-dirty">{{ t('note.imageEditor.unsaved') }}</span>
            <div class="image-editor-footer-actions">
              <button class="image-editor-btn secondary" type="button" @click="close">{{ t('note.cancel') }}</button>
              <button class="image-editor-btn primary" type="button" :disabled="loading || !!loadError" @click="save">{{ t('note.imageEditor.save') }}</button>
            </div>
          </footer>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup>
import { computed, nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Crop, Grid2X2, Image as ImageIcon, Move, PenLine, RefreshCw, RotateCcw, RotateCw, Type, ZoomIn, ZoomOut } from 'lucide-vue-next'

const props = defineProps({
  visible: Boolean,
  src: { type: String, default: '' },
  alt: { type: String, default: '' },
  width: { type: Number, default: 0 },
  height: { type: Number, default: 0 },
})

const emit = defineEmits(['close', 'save'])
const { t } = useI18n()

const canvasRef = ref(null)
const stageRef = ref(null)
const loading = ref(false)
const loadError = ref('')
const activeTool = ref('pan')
const zoom = ref(1)
const offset = ref({ x: 0, y: 0 })
const rotation = ref(0)
const dirty = ref(false)
const strokeColor = ref('#ef4444')
const strokeWidth = ref(4)
const textColor = ref('#ef4444')
const textValue = ref('')
const outputWidth = ref(0)
const outputHeight = ref(0)
const cropRect = ref(null)
const dragState = ref(null)
const imageElement = ref(null)
const originalSnapshot = ref(null)

const canvasStyle = computed(() => ({
  transform: `translate(${offset.value.x}px, ${offset.value.y}px) scale(${zoom.value}) rotate(${rotation.value}deg)`,
}))

const cropStyle = computed(() => {
  if (!cropRect.value) return {}
  // Keep the overlay in sync with view transforms while the user zooms/pans.
  void zoom.value
  void offset.value
  void rotation.value
  const rect = cropRect.value
  const canvas = canvasRef.value
  const stage = stageRef.value
  if (!canvas || !stage || !canvas.width || !canvas.height) return {}
  const canvasRect = canvas.getBoundingClientRect()
  const stageRect = stage.getBoundingClientRect()
  const scaleX = canvasRect.width / canvas.width
  const scaleY = canvasRect.height / canvas.height
  return {
    left: `${canvasRect.left - stageRect.left + rect.x * scaleX}px`,
    top: `${canvasRect.top - stageRect.top + rect.y * scaleY}px`,
    width: `${rect.width * scaleX}px`,
    height: `${rect.height * scaleY}px`,
  }
})

const markDirty = () => { dirty.value = true }

const canvasPoint = (event) => {
  const canvas = canvasRef.value
  const rect = canvas?.getBoundingClientRect()
  if (!canvas || !rect) return { x: 0, y: 0 }
  // getBoundingClientRect() includes the CSS scale/translation. Mapping from
  // the rect's top-left alone makes drawings drift after zooming or panning.
  // Work from the transformed canvas centre and invert the linear transform,
  // then convert CSS pixels back to the canvas's backing-store pixels.
  const cssWidth = canvas.offsetWidth || canvas.clientWidth || canvas.width
  const cssHeight = canvas.offsetHeight || canvas.clientHeight || canvas.height
  const centreX = rect.left + rect.width / 2
  const centreY = rect.top + rect.height / 2
  let localX = event.clientX - centreX
  let localY = event.clientY - centreY
  if (typeof window.DOMMatrix === 'function' && typeof window.DOMPoint === 'function') {
    try {
      const raw = new window.DOMMatrix(getComputedStyle(canvas).transform)
      // Translation is already represented by the transformed centre.
      const linear = new window.DOMMatrix([raw.a, raw.b, raw.c, raw.d, 0, 0])
      const point = linear.inverse().transformPoint(new window.DOMPoint(localX, localY))
      localX = point.x
      localY = point.y
    } catch (_error) {
      localX /= zoom.value
      localY /= zoom.value
    }
  } else {
    localX /= zoom.value
    localY /= zoom.value
  }
  const x = (localX + cssWidth / 2) * (canvas.width / Math.max(cssWidth, 1))
  const y = (localY + cssHeight / 2) * (canvas.height / Math.max(cssHeight, 1))
  return {
    x: Math.max(0, Math.min(canvas.width, x)),
    y: Math.max(0, Math.min(canvas.height, y)),
  }
}

const drawMosaic = (point) => {
  const canvas = canvasRef.value
  const ctx = canvas?.getContext('2d')
  if (!ctx) return
  const size = 18
  const x = Math.max(0, Math.min(canvas.width - 1, Math.round(point.x - size / 2)))
  const y = Math.max(0, Math.min(canvas.height - 1, Math.round(point.y - size / 2)))
  const width = Math.min(size, canvas.width - x)
  const height = Math.min(size, canvas.height - y)
  if (width <= 0 || height <= 0) return
  const image = ctx.getImageData(x, y, width, height)
  let r = 0; let g = 0; let b = 0; let count = 0
  for (let i = 0; i < image.data.length; i += 4) { r += image.data[i]; g += image.data[i + 1]; b += image.data[i + 2]; count += 1 }
  if (!count) return
  ctx.fillStyle = `rgb(${Math.round(r / count)}, ${Math.round(g / count)}, ${Math.round(b / count)})`
  ctx.fillRect(x, y, width, height)
}

const toggleTool = (tool) => { activeTool.value = activeTool.value === tool ? 'pan' : tool; cropRect.value = null }
const zoomBy = (delta) => { zoom.value = Math.max(0.2, Math.min(4, Number((zoom.value + delta).toFixed(2)))) }
const handleWheel = (event) => { zoomBy(event.deltaY > 0 ? -0.1 : 0.1) }

const handlePointerDown = (event) => {
  event.currentTarget.setPointerCapture?.(event.pointerId)
  const point = canvasPoint(event)
  if (activeTool.value === 'pan') {
    dragState.value = { mode: 'pan', startX: event.clientX, startY: event.clientY, offsetX: offset.value.x, offsetY: offset.value.y }
  } else if (activeTool.value === 'crop') {
    dragState.value = { mode: 'crop', start: point }
    cropRect.value = { x: point.x, y: point.y, width: 0, height: 0 }
  } else if (activeTool.value === 'draw' || activeTool.value === 'mosaic') {
    dragState.value = { mode: activeTool.value, last: point }
    if (activeTool.value === 'draw') {
      const ctx = canvasRef.value.getContext('2d'); ctx.beginPath(); ctx.moveTo(point.x, point.y)
    } else drawMosaic(point)
    markDirty()
  } else if (activeTool.value === 'text' && textValue.value.trim()) {
    const ctx = canvasRef.value.getContext('2d')
    ctx.font = '600 24px sans-serif'; ctx.fillStyle = textColor.value; ctx.fillText(textValue.value.trim(), point.x, point.y)
    markDirty()
  }
}

const handlePointerMove = (event) => {
  if (!dragState.value) return
  const point = canvasPoint(event)
  const state = dragState.value
  if (state.mode === 'pan') {
    offset.value = { x: state.offsetX + event.clientX - state.startX, y: state.offsetY + event.clientY - state.startY }
    return
  }
  if (state.mode === 'crop') {
    cropRect.value = { x: Math.min(state.start.x, point.x), y: Math.min(state.start.y, point.y), width: Math.abs(point.x - state.start.x), height: Math.abs(point.y - state.start.y) }
    return
  }
  const ctx = canvasRef.value.getContext('2d')
  if (state.mode === 'draw') {
    ctx.strokeStyle = strokeColor.value; ctx.lineWidth = strokeWidth.value; ctx.lineCap = 'round'; ctx.lineTo(point.x, point.y); ctx.stroke(); state.last = point
  } else if (state.mode === 'mosaic') drawMosaic(point)
}

const handlePointerUp = (event) => {
  if (dragState.value?.mode === 'crop' && cropRect.value?.width > 2 && cropRect.value?.height > 2) markDirty()
  dragState.value = null
  event.currentTarget.releasePointerCapture?.(event.pointerId)
}
const handlePointerLeave = () => { if (dragState.value?.mode !== 'pan') dragState.value = null }

const applyRotation = (degrees) => {
  const canvas = canvasRef.value
  if (!canvas || !degrees || degrees % 360 === 0) return
  const normalized = ((degrees % 360) + 360) % 360
  const radians = normalized * Math.PI / 180
  const target = document.createElement('canvas')
  const quarterTurn = normalized === 90 || normalized === 270
  target.width = quarterTurn ? canvas.height : canvas.width
  target.height = quarterTurn ? canvas.width : canvas.height
  const ctx = target.getContext('2d')
  ctx.translate(target.width / 2, target.height / 2)
  ctx.rotate(radians)
  ctx.drawImage(canvas, -canvas.width / 2, -canvas.height / 2)
  canvas.width = target.width
  canvas.height = target.height
  canvas.getContext('2d').drawImage(target, 0, 0)
  outputWidth.value = canvas.width
  outputHeight.value = canvas.height
  rotation.value = 0
  offset.value = { x: 0, y: 0 }
  zoom.value = 1
}

const rotate = (degrees) => { applyRotation(degrees); markDirty() }

const drawSource = (src) => new Promise((resolve, reject) => {
  const image = new window.Image()
  image.onload = () => {
    imageElement.value = image
    const canvas = canvasRef.value
    const ctx = canvas.getContext('2d')
    canvas.width = image.naturalWidth || image.width
    canvas.height = image.naturalHeight || image.height
    outputWidth.value = props.width || canvas.width
    outputHeight.value = props.height || canvas.height
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height)
    originalSnapshot.value = canvas.toDataURL('image/png')
    zoom.value = 1; offset.value = { x: 0, y: 0 }; rotation.value = 0; cropRect.value = null; dirty.value = false
    resolve()
  }
  image.onerror = () => reject(new Error(t('note.imageEditor.loadFailed')))
  image.src = src
})

const resetImage = async () => {
  if (!originalSnapshot.value) return
  try { await drawSource(originalSnapshot.value) } catch (error) { loadError.value = error.message }
}

const applyCrop = () => {
  const crop = cropRect.value
  const canvas = canvasRef.value
  if (!crop || crop.width < 2 || crop.height < 2 || !canvas) return
  const target = document.createElement('canvas'); target.width = Math.round(crop.width); target.height = Math.round(crop.height)
  target.getContext('2d').drawImage(canvas, crop.x, crop.y, crop.width, crop.height, 0, 0, target.width, target.height)
  canvas.width = target.width; canvas.height = target.height; canvas.getContext('2d').drawImage(target, 0, 0)
  outputWidth.value = canvas.width; outputHeight.value = canvas.height; cropRect.value = null
}

const resizeOutput = () => {
  const canvas = canvasRef.value
  const width = Number(outputWidth.value)
  const height = Number(outputHeight.value)
  if (!canvas || !width || !height || (width === canvas.width && height === canvas.height)) return
  const target = document.createElement('canvas'); target.width = width; target.height = height
  target.getContext('2d').drawImage(canvas, 0, 0, width, height)
  canvas.width = width; canvas.height = height; canvas.getContext('2d').drawImage(target, 0, 0)
}

const save = () => {
  if (!canvasRef.value) return
  applyCrop(); resizeOutput()
  emit('save', { src: canvasRef.value.toDataURL('image/png'), width: canvasRef.value.width, height: canvasRef.value.height, alt: props.alt })
  close()
}
const close = () => { emit('close') }

watch(() => [props.visible, props.src], async ([visible, src]) => {
  if (!visible || !src) return
  loading.value = true; loadError.value = ''
  await nextTick()
  try { await drawSource(src) } catch (error) { loadError.value = error.message || String(error) } finally { loading.value = false }
}, { immediate: true })
</script>

<style scoped>
.note-image-editor-overlay { position: fixed; inset: 0; z-index: 10050; display: flex; align-items: center; justify-content: center; background: rgba(15, 23, 42, .62); backdrop-filter: blur(4px); }
.note-image-editor { width: min(1080px, 94vw); height: min(760px, 92vh); display: flex; flex-direction: column; overflow: hidden; color: var(--text-primary, #1f2937); background: var(--bg-primary, #fff); border: 1px solid var(--border-color, #e5e7eb); border-radius: 12px; box-shadow: 0 28px 100px rgba(0,0,0,.35); }
.note-image-editor-header, .note-image-editor-footer { display: flex; align-items: center; justify-content: space-between; min-height: 52px; padding: 0 18px; border-bottom: 1px solid var(--border-color, #e5e7eb); }
.note-image-editor-footer { border-top: 1px solid var(--border-color, #e5e7eb); border-bottom: 0; }
.note-image-editor-title { display: flex; align-items: center; gap: 8px; font-size: 14px; font-weight: 600; }
.image-editor-close { border: 0; background: transparent; color: var(--text-tertiary, #94a3b8); font-size: 24px; line-height: 1; cursor: pointer; }
.note-image-editor-body { display: flex; flex: 1; min-height: 0; background: var(--bg-secondary, #f8fafc); }
.image-editor-stage { position: relative; display: flex; align-items: center; justify-content: center; flex: 1; min-width: 0; min-height: 0; overflow: hidden; background: repeating-conic-gradient(#f1f5f9 0 25%, #e2e8f0 0 50%) 50% / 22px 22px; }
.image-editor-stage.panning { cursor: grab; } .image-editor-stage.panning:active { cursor: grabbing; } .image-editor-stage.cropping { cursor: crosshair; }
.image-editor-canvas { max-width: 92%; max-height: 92%; transform-origin: center; box-shadow: 0 8px 30px rgba(15,23,42,.18); touch-action: none; user-select: none; }
.crop-selection { position: absolute; pointer-events: none; border: 2px solid #2563eb; background: rgba(37,99,235,.12); box-shadow: 0 0 0 9999px rgba(15,23,42,.35); }
.image-editor-loading, .image-editor-error { position: absolute; padding: 10px 14px; border-radius: 8px; background: rgba(255,255,255,.9); font-size: 13px; }
.image-editor-error { color: #b91c1c; }
.image-editor-tools { width: 220px; flex: 0 0 220px; padding: 16px; overflow-y: auto; background: var(--bg-primary, #fff); border-left: 1px solid var(--border-color, #e5e7eb); }
.image-editor-tool-group { display: flex; align-items: center; gap: 4px; padding-bottom: 12px; margin-bottom: 12px; border-bottom: 1px solid var(--border-color, #eef2f7); }
.image-editor-tool { display: inline-flex; align-items: center; justify-content: center; width: 30px; height: 30px; border: 1px solid transparent; border-radius: 6px; color: var(--text-secondary, #475569); background: transparent; cursor: pointer; }
.image-editor-tool:hover, .image-editor-tool.active { color: var(--accent-color, #2563eb); background: var(--bg-hover, #eff6ff); border-color: var(--accent-light, #bfdbfe); }
.image-editor-zoom { min-width: 42px; text-align: center; font-size: 11px; color: var(--text-tertiary, #94a3b8); }
.image-editor-option { display: flex; flex-direction: column; gap: 9px; padding-bottom: 14px; font-size: 12px; color: var(--text-secondary, #475569); }
.image-editor-option label { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.image-editor-option input[type=text], .image-editor-option input[type=number] { width: 100px; padding: 5px 7px; border: 1px solid var(--border-color, #cbd5e1); border-radius: 5px; background: var(--bg-primary, #fff); color: inherit; }
.image-editor-option input[type=color] { width: 32px; height: 24px; padding: 0; border: 0; background: transparent; }
.image-editor-size { flex-direction: row; align-items: center; } .image-editor-size label { flex: 1; display: block; } .image-editor-size input { width: 78px; margin-top: 4px; }
.image-editor-hint { margin: 0; color: var(--text-tertiary, #94a3b8); font-size: 11px; line-height: 1.5; }
.image-editor-dirty { color: var(--text-tertiary, #64748b); font-size: 12px; } .image-editor-footer-actions { display: flex; gap: 8px; }
.image-editor-btn { padding: 7px 16px; border: 0; border-radius: 7px; font: inherit; font-size: 13px; cursor: pointer; } .image-editor-btn.secondary { color: var(--text-secondary, #475569); background: var(--bg-secondary, #f1f5f9); } .image-editor-btn.primary { color: #fff; background: var(--accent-color, #2563eb); } .image-editor-btn:disabled { opacity: .5; cursor: not-allowed; }
.note-image-editor-fade-enter-active, .note-image-editor-fade-leave-active { transition: opacity .18s ease; } .note-image-editor-fade-enter-from, .note-image-editor-fade-leave-to { opacity: 0; }
@media (max-width: 760px) { .note-image-editor-body { flex-direction: column; } .image-editor-tools { width: auto; flex: 0 0 auto; max-height: 190px; border-left: 0; border-top: 1px solid var(--border-color, #e5e7eb); } .image-editor-tool-group { display: inline-flex; margin-right: 12px; } }
</style>
