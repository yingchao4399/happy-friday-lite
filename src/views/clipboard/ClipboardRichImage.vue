<template>
  <NodeViewWrapper as="span" class="rich-image-node" :contenteditable="false" @dblclick.stop>
    <ClipboardImage :item-id="extension.options.itemId" :html-index="imageIndex" :revision="node.attrs.src" :edit-disabled="editingText" @saved="extension.options.onSaved" />
  </NodeViewWrapper>
</template>
<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { NodeViewWrapper, nodeViewProps } from '@tiptap/vue-3'
import ClipboardImage from './ClipboardImage.vue'
const props = defineProps(nodeViewProps)
const imageIndex = ref(0), editingText = ref(props.editor.isEditable)
function updateState() {
  const position = props.getPos()
  if (typeof position !== 'number') return
  let index = 0
  props.editor.state.doc.descendants((node, pos) => { if (pos < position && node.type.name === 'image') index++ })
  imageIndex.value = index; editingText.value = props.editor.isEditable
}
onMounted(() => { updateState(); props.editor.on('transaction', updateState); props.editor.on('update', updateState) })
onBeforeUnmount(() => { props.editor.off('transaction', updateState); props.editor.off('update', updateState) })
</script>
<style scoped>
.rich-image-node{display:inline-block;vertical-align:middle;max-width:100%;margin:8px 0;white-space:normal}
</style>
