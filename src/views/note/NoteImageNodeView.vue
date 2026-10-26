<template>
  <NodeViewWrapper class="note-image-node" :class="{ 'image-selected': selected, 'image-resizing': resizing }" contenteditable="false">
    <span ref="frame" class="note-image-frame" :style="frameStyle" @click.stop="selectImage" @dblclick.prevent.stop="previewImage">
      <img :src="node.attrs.src" :alt="node.attrs.alt || ''" :title="node.attrs.title || ''"
        class="editor-image" :style="imageStyle" draggable="false" @load="onLoad" />
      <template v-if="selected && editor.isEditable">
        <button v-for="corner in ['nw', 'ne', 'sw', 'se']" :key="corner" type="button"
          :class="['note-image-resize-handle', `handle-${corner}`]" :aria-label="t('note.imageEditor.resize')"
          @pointerdown.prevent.stop="beginResize($event, corner)" @click.prevent.stop />
        <span class="note-image-size" aria-live="polite">{{ Math.round(displayWidth) }} × {{ Math.round(displayHeight) }}</span>
      </template>
    </span>
  </NodeViewWrapper>
</template>

<script setup>
import { computed, onBeforeUnmount, ref } from 'vue'
import { NodeViewWrapper, nodeViewProps } from '@tiptap/vue-3'
import { useI18n } from 'vue-i18n'

const props = defineProps(nodeViewProps)
const { t } = useI18n()
const frame = ref(null)
const naturalWidth = ref(0)
const naturalHeight = ref(0)
const liveSize = ref(null)
const resizing = ref(false)
const numericSize = value => Math.max(0, Number.parseFloat(value) || 0)
const displayWidth = computed(() => liveSize.value?.width || numericSize(props.node.attrs.width) || naturalWidth.value || 320)
const displayHeight = computed(() => liveSize.value?.height || numericSize(props.node.attrs.height) || displayWidth.value * (naturalHeight.value / (naturalWidth.value || 1) || .75))
const frameStyle = computed(() => ({ width: `${displayWidth.value}px` }))
const imageStyle = computed(() => ({ aspectRatio: `${displayWidth.value} / ${displayHeight.value}`, margin: '0', width: '100%', height: 'auto', display: 'block' }))
const onLoad = event => { naturalWidth.value = event.target.naturalWidth; naturalHeight.value = event.target.naturalHeight }
const selectImage = () => {
  const pos = props.getPos()
  if (typeof pos === 'number') props.editor.commands.setNodeSelection(pos)
}
const previewImage = () => props.extension.options.onPreview?.({ node: props.node, pos: props.getPos(), src: props.node.attrs.src })

let cleanup = null
const beginResize = (event, corner) => {
  if (!props.editor.isEditable) return
  cleanup?.()
  selectImage()
  const rect = frame.value.getBoundingClientRect()
  const width = rect.width
  const height = rect.height
  const startX = event.clientX
  const startY = event.clientY
  const ratio = height / Math.max(1, width)
  const handle = event.currentTarget
  const onMove = move => {
    const dx = (move.clientX - startX) * (corner.includes('w') ? -1 : 1)
    const dy = (move.clientY - startY) * (corner.includes('n') ? -1 : 1)
    let nextWidth = Math.max(40, Math.min(4096, width + dx))
    let nextHeight = Math.max(30, Math.min(4096, height + dy))
    if (!move.shiftKey) {
      const scale = Math.abs(dx / width) >= Math.abs(dy / Math.max(1, height)) ? nextWidth / width : nextHeight / height
      nextWidth = Math.max(40, Math.min(4096, width * scale))
      nextHeight = Math.max(30, Math.min(4096, nextWidth * ratio))
    }
    liveSize.value = { width: Math.round(nextWidth), height: Math.round(nextHeight) }
  }
  const finish = () => {
    const size = liveSize.value
    cleanup?.()
    if (size) props.updateAttributes({ width: String(size.width), height: String(size.height) })
    liveSize.value = null
  }
  cleanup = () => {
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', finish)
    window.removeEventListener('pointercancel', finish)
    window.removeEventListener('blur', finish)
    if (handle.hasPointerCapture?.(event.pointerId)) handle.releasePointerCapture(event.pointerId)
    resizing.value = false
    cleanup = null
  }
  resizing.value = true
  handle.setPointerCapture?.(event.pointerId)
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', finish, { once: true })
  window.addEventListener('pointercancel', finish, { once: true })
  window.addEventListener('blur', finish, { once: true })
}
onBeforeUnmount(() => cleanup?.())
</script>

<style scoped>
.note-image-node { display: block; margin: 12px 0; max-width: 100%; }
.note-image-frame { position: relative; display: inline-block; max-width: 100%; vertical-align: top; line-height: 0; }
.note-image-frame img.editor-image { display: block; width: 100%; max-width: 100%; height: auto; margin: 0; cursor: pointer; object-fit: fill; }
.image-selected .note-image-frame { outline: 2px solid var(--accent-color, #2563eb); outline-offset: 1px; }
.note-image-resize-handle { position: absolute; z-index: 4; width: 14px; height: 14px; padding: 0; border: 2px solid var(--accent-color, #2563eb); border-radius: 2px; background: var(--bg-primary, #fff); touch-action: none; }
.handle-nw { left: -7px; top: -7px; cursor: nwse-resize; } .handle-ne { right: -7px; top: -7px; cursor: nesw-resize; }
.handle-sw { left: -7px; bottom: -7px; cursor: nesw-resize; } .handle-se { right: -7px; bottom: -7px; cursor: nwse-resize; }
.note-image-size { position: absolute; right: 10px; bottom: 8px; padding: 4px 6px; border-radius: 4px; background: var(--bg-primary, #fff); color: var(--text-secondary, #475569); box-shadow: 0 1px 5px #0002; font-size: 11px; line-height: 1.2; pointer-events: none; }
.image-resizing { user-select: none; }
</style>
