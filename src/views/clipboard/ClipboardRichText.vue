<template>
  <div class="rich-content" @dblclick="$emit('edit')">
    <div v-if="editable && editor" class="rich-toolbar">
      <FridayButton v-for="command in commands" :key="command.name" compact :aria-pressed="editor.isActive(command.name)" @click="command.run()">{{ t(command.label) }}</FridayButton>
    </div>
    <EditorContent :editor="editor" />
  </div>
</template>
<script setup>
// 与原版笔记编辑器使用相同 Tiptap 技术和主题变量，不将剪贴板 HTML 直接插入 DOM。
import { watch } from 'vue'
import { useEditor, EditorContent, VueNodeViewRenderer } from '@tiptap/vue-3'
import Image from '@tiptap/extension-image'
import ClipboardRichImage from './ClipboardRichImage.vue'
import StarterKit from '@tiptap/starter-kit'
import { Table } from '@tiptap/extension-table'
import TableRow from '@tiptap/extension-table-row'
import TableCell from '@tiptap/extension-table-cell'
import TableHeader from '@tiptap/extension-table-header'
import { TextStyle } from '@tiptap/extension-text-style'
import Color from '@tiptap/extension-color'
import TextAlign from '@tiptap/extension-text-align'
import { useI18n } from 'vue-i18n'
import FridayButton from '@/components/ui/FridayButton.vue'
const props = defineProps({ html: String, editable: Boolean, itemId: String })
const emit = defineEmits(['edit', 'image-saved'])
const { t } = useI18n()
const ClipboardImageNode = Image.extend({ addNodeView() { return VueNodeViewRenderer(ClipboardRichImage) } }).configure({ inline: true, allowBase64: true, itemId: props.itemId, onSaved: item => emit('image-saved', item) })
const editor = useEditor({ content: props.html || '', editable: props.editable, extensions: [StarterKit.configure({ link: { openOnClick: false } }), ClipboardImageNode, Table, TableRow, TableHeader, TableCell, TextStyle, Color, TextAlign.configure({ types: ['heading', 'paragraph'] })] })
watch(() => props.html, html => { if (editor.value && html !== editor.value.getHTML()) editor.value.commands.setContent(html || '') })
watch(() => props.editable, editable => {
  editor.value?.setEditable(editable)
  if (editable) editor.value?.commands.focus()
  else if (editor.value && props.html !== editor.value.getHTML()) editor.value.commands.setContent(props.html || '')
})
const commands = [
  { name: 'bold', label: 'clipboard.bold', run: () => editor.value?.chain().focus().toggleBold().run() },
  { name: 'italic', label: 'clipboard.italic', run: () => editor.value?.chain().focus().toggleItalic().run() },
  { name: 'bulletList', label: 'clipboard.bulletList', run: () => editor.value?.chain().focus().toggleBulletList().run() },
  { name: 'undo', label: 'clipboard.undo', run: () => editor.value?.chain().focus().undo().run() }
]
defineExpose({ value: () => ({ html: editor.value?.getHTML() || '', plainText: editor.value?.getText({ blockSeparator: '\n' }) || '' }) })
</script>
<style scoped>
.rich-content{border:1px solid var(--border-color);border-radius:8px;background:var(--bg-secondary);overflow:hidden}.rich-toolbar{display:flex;gap:5px;flex-wrap:wrap;padding:8px;border-bottom:1px solid var(--border-color)}.rich-content :deep(.tiptap){min-height:90px;max-height:48vh;overflow:auto;padding:16px;outline:none;font-size:13px;line-height:1.7;color:var(--text-primary);overflow-wrap:anywhere;user-select:text}.rich-content :deep(table){border-collapse:collapse;width:100%}.rich-content :deep(td),.rich-content :deep(th){border:1px solid var(--border-color);padding:6px}.rich-content :deep(pre){white-space:pre-wrap;font-family:monospace}.rich-content :deep(p){margin:0 0 8px}
</style>
