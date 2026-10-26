<template>
  <NodeViewWrapper class="note-media-node" :class="{ selected }">
    <div class="note-media-card" contenteditable="false">
      <div class="note-media-name"><component :is="isVideo ? Video : Music2" :size="15" /><span>{{ node.attrs.title || t('note.media.untitled') }}</span></div>
      <video v-if="isVideo" :src="node.attrs.src" data-note-video controls preload="metadata" @click.stop @dblclick.stop.prevent="act('onPreview')" @error="failed = true" @loadedmetadata="failed = false" />
      <audio v-else :src="node.attrs.src" data-note-audio controls preload="metadata" @click.stop @dblclick.stop.prevent="act('onPreview')" @error="failed = true" @loadedmetadata="failed = false" />
      <p v-if="failed" class="note-media-load-error" role="alert">{{ t('note.media.playFailed') }}</p>
      <div class="note-media-tools">
        <FridayButton compact @click.stop="act('onPreview')"><Maximize2 :size="14" />{{ t('note.media.preview') }}</FridayButton>
        <FridayButton compact @click.stop="act('onOpen')"><ExternalLink :size="14" />{{ t('note.media.open') }}</FridayButton>
        <FridayButton compact :disabled="!local" :title="local ? t('note.media.openLocation') : t('note.media.noLocalFile')" @click.stop="act('onReveal')"><FolderOpen :size="14" />{{ t('note.media.openLocation') }}</FridayButton>
      </div>
    </div>
  </NodeViewWrapper>
</template>
<script setup>
import { computed, ref, watch } from 'vue'
import { NodeViewWrapper } from '@tiptap/vue-3'
import { useI18n } from 'vue-i18n'
import { ExternalLink, FolderOpen, Maximize2, Music2, Video } from 'lucide-vue-next'
import FridayButton from '@/components/ui/FridayButton.vue'
import { notePathFromUrl } from './media-path.js'
const props = defineProps({ node: Object, extension: Object, getPos: Function, selected: Boolean })
const { t } = useI18n()
const failed = ref(false)
const isVideo = computed(() => props.node.type.name === 'noteVideo')
const local = computed(() => props.node.attrs.src && !/^(?:https?|data|blob):/i.test(props.node.attrs.src))
watch(() => props.node.attrs.src, () => { failed.value = false })
function act(action) {
  props.extension.options[action]?.({ kind: isVideo.value ? 'video' : 'audio', src: props.node.attrs.src, path: notePathFromUrl(props.node.attrs.src), title: props.node.attrs.title, node: props.node, pos: props.getPos?.() })
}
</script>
<style scoped>
.note-media-node{margin:14px 0;border:1px solid var(--border-color);border-radius:8px;overflow:hidden;max-width:100%;background:var(--bg-primary)}.note-media-node.selected{outline:1px solid var(--text-tertiary)}.note-media-card{padding:12px}.note-media-name{display:flex;align-items:center;gap:7px;font-size:12px;color:var(--text-secondary);margin-bottom:10px}.note-media-name span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.note-media-card video{display:block;width:100%;max-height:440px;background:#151515;border-radius:6px}.note-media-card audio{display:block;width:100%}.note-media-tools{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}.note-media-load-error{font-size:12px;color:var(--danger-color,#c05252);margin:8px 0;line-height:1.6}
</style>
