<template>
  <Teleport to="body"><div v-if="item" class="context-menu-overlay" @pointerdown.self="$emit('close')" @contextmenu.prevent.self="$emit('close')">
    <div ref="menu" class="context-menu" role="menu" :aria-label="t('clipboard.itemActions')" :style="{ left: position.x + 'px', top: position.y + 'px' }" @keydown.esc.stop="$emit('close')" @keydown.down.prevent="move(1)" @keydown.up.prevent="move(-1)" @keydown.home.prevent="focusAt(0)" @keydown.end.prevent="focusAt(-1)" @keydown.tab.prevent="$emit('close')">
      <button v-for="action in actions" :key="action.key" class="context-menu-item" :class="{ danger: action.key === 'delete' }" type="button" role="menuitem" :disabled="busy || action.disabled" :title="action.reason || ''" @click="$emit('action', action.key)"><component :is="action.icon" :size="15" /><span>{{ action.label }}</span></button>
    </div>
  </div></Teleport>
</template>
<script setup>
import { computed, nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Copy, File, FileText, Folder, Image, Pencil, Pin, PinOff, Sparkles, Star, StickyNote, Tag, Trash2 } from 'lucide-vue-next'
const props = defineProps({ item: Object, x: Number, y: Number, busy: Boolean, screenPinned: Boolean })
defineEmits(['close', 'action'])
const { t } = useI18n()
const menu = ref(null), position = ref({ x: 0, y: 0 })
let previousFocus
const actions = computed(() => {
  const item = props.item
  if (!item) return []
  const sensitive = item.sensitivity === 'secret'
  const entries = [{ key: 'copy', label: t(item.filePaths?.length ? 'clipboard.copyFile' : 'clipboard.copy'), icon: item.filePaths?.length ? File : Copy }]
  if (item.filePaths?.length) {
    const target = item.fileEntries?.[item.targetFileIndex ?? 0]
    const folder = target?.kind === 'folder' && (item.filePaths.length === 1 || Number.isInteger(item.targetFileIndex))
    entries.push({ key: 'open-file', label: t(folder ? 'clipboard.openDirectory' : 'clipboard.openFile'), icon: folder ? Folder : File })
    entries.push({ key: 'open-folder', label: t('clipboard.openFolder'), icon: Folder })
    entries.push({ key: 'path', label: t('clipboard.copyPath'), icon: Folder })
  }
  if (item.html && item.plainText && !sensitive) entries.push({ key: 'text', label: t('clipboard.copyText'), icon: FileText })
  if ((item.imagePath || item.imagePaths?.length) && !sensitive) entries.push({ key: 'preview', label: t('clipboard.openImage'), icon: Image })
  // 手机二维码/局域网分享属于下一轮外部剪贴板能力，本轮不显示入口。
  entries.push({ key: 'pin', label: t(item.pinned ? 'clipboard.unpin' : 'clipboard.pin'), icon: item.pinned ? PinOff : Pin })
  entries.push({ key: 'favorite', label: t(item.favorite ? 'clipboard.unfavorite' : 'clipboard.favorite'), icon: Star })
  if (!sensitive) {
    if (['text', 'html', 'link'].includes(item.kind)) entries.push({ key: 'phrase', label: t(item.phrase ? 'clipboard.removePhrase' : 'clipboard.addPhrase'), icon: StickyNote })
    if (item.phrase) entries.push({ key: 'edit', label: t('clipboard.editPhrase'), icon: Pencil })
    entries.push({ key: 'organize', label: t('clipboard.editOrganization'), icon: Tag })
    entries.push({ key: 'note', label: t(item.savedNoteId ? 'clipboard.openNote' : 'clipboard.saveNote'), icon: FileText })
    if (item.kind !== 'folder') entries.push({ key: 'ai', label: t('clipboard.analyzeAI'), icon: Sparkles })
  }
  entries.push({ key: 'delete', label: t('clipboard.delete'), icon: Trash2 })
  return entries
})
const buttons = () => [...(menu.value?.querySelectorAll('button:not(:disabled)') || [])]
function focusAt(index) { buttons().at(index)?.focus() }
function move(offset) { const list = buttons(), index = list.indexOf(document.activeElement); list[(index + offset + list.length) % list.length]?.focus() }
watch(() => props.item, async item => {
  if (item) {
    previousFocus = document.activeElement
    position.value = { x: props.x, y: props.y }
    await nextTick()
    const rect = menu.value?.getBoundingClientRect()
    if (rect) position.value = { x: Math.max(8, Math.min(props.x, window.innerWidth - rect.width - 8)), y: Math.max(8, Math.min(props.y, window.innerHeight - rect.height - 8)) }
    focusAt(0)
  } else if (previousFocus?.isConnected) previousFocus.focus()
})
</script>
<style scoped>
/* 官方知识库右键菜单的结构和样式，补齐键盘焦点与窗口边界限制。 */
.context-menu-overlay{position:fixed;inset:0;z-index:1001}.context-menu{position:fixed;z-index:1002;min-width:190px;max-height:calc(100dvh - 16px);overflow:auto;background:var(--bg-primary);border:1px solid var(--border-color);border-radius:8px;padding:4px;box-shadow:0 4px 16px rgba(0,0,0,.12)}.context-menu-item{display:flex;align-items:center;gap:9px;width:100%;padding:8px 10px;min-height:32px;background:transparent;border:0;border-radius:5px;color:var(--text-primary);font:inherit;font-size:13px;text-align:left;cursor:pointer}.context-menu-item:hover,.context-menu-item:focus-visible{outline:none;background:var(--bg-hover)}.context-menu-item.danger{color:#d9544d}.context-menu-item:disabled{opacity:.45;cursor:default}
</style>
