<template>
  <div class="clipboard-files" @click.stop @keydown.enter.stop>
    <article v-for="entry in entries" :key="entry.index + ':' + entry.path" @contextmenu.stop.prevent="$emit('contextmenu', $event, { ...item, targetFileIndex: entry.index })">
      <div class="file-link-row">
        <button class="file-icon" type="button" :title="t(entry.kind === 'folder' ? 'clipboard.openDirectory' : 'clipboard.openFile')" :aria-label="t(entry.kind === 'folder' ? 'clipboard.openDirectory' : 'clipboard.openFile') + ': ' + entry.name" @click="open(entry)"><Folder v-if="entry.kind === 'folder'" :size="24" :stroke-width="1.6" /><File v-else :size="24" :stroke-width="1.6" /></button>
        <div><button class="file-link" type="button" :title="entry.path" @click="open(entry)">{{ entry.name }}</button><span class="file-path">{{ entry.path }}</span><span v-if="entry.available === false" class="file-unavailable">{{ t('clipboard.fileMissing') }}</span></div>
      </div>
      <ClipboardImage v-if="entry.kind === 'image'" :key="item.id + ':' + entry.path" :item-id="item.id" :file-index="entry.index" :revision="item.hash" @saved="$emit('changed', $event)" />
    </article>
    <button v-if="limit && item.filePaths.length > limit" class="file-link more-files" type="button" @click="$emit('detail')">{{ t('clipboard.moreFiles', { count: item.filePaths.length - limit }) }}</button>
    <FridayNotice v-if="error" error>{{ error }}</FridayNotice>
  </div>
</template>
<script setup>
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { File, Folder } from 'lucide-vue-next'
import FridayNotice from '@/components/ui/FridayNotice.vue'
import ClipboardImage from './ClipboardImage.vue'
import { electronService } from '@/services/electron'
const props = defineProps({ item: { type: Object, required: true }, limit: { type: Number, default: 0 } })
defineEmits(['contextmenu', 'changed', 'detail'])
const { t } = useI18n(), error = ref('')
const entries = computed(() => {
  const files = props.item.fileEntries || (props.item.filePaths || []).map((path, index) => ({ path, index, name: path.split(/[\\/]/).pop(), kind: 'file' }))
  return props.limit ? files.slice(0, props.limit) : files
})
async function open(entry) {
  error.value = ''
  try { await electronService.request('clipboard-file-open', { id: props.item.id, index: entry.index, mode: 'open' }) }
  catch (e) { error.value = t(e.message?.includes('MISSING') ? 'clipboard.fileMissing' : 'clipboard.fileOpenFailed') }
}
</script>
<style scoped>
.clipboard-files{display:flex;flex-direction:column;gap:10px;min-width:0}.file-link-row{display:flex;gap:9px;align-items:center;min-width:0}.file-link-row>div{min-width:0;flex:1}.file-icon{display:flex;align-items:center;justify-content:center;flex-shrink:0;width:36px;height:36px;border:0;border-radius:6px;background:var(--bg-secondary);color:var(--text-secondary);cursor:pointer}.file-icon:hover{background:var(--bg-hover);color:var(--accent-color)}.file-icon:focus-visible,.file-link:focus-visible{outline:2px solid var(--accent-color);outline-offset:2px}.file-link{display:block;max-width:100%;padding:0;border:0;background:transparent;color:var(--accent-color);font:inherit;font-size:13px;text-align:left;overflow-wrap:anywhere;cursor:pointer}.file-link:hover{text-decoration:underline}.file-path{display:block;color:var(--text-tertiary);font-size:11px;line-height:1.5;overflow-wrap:anywhere;user-select:text}.file-unavailable{font-size:11px;color:var(--text-secondary)}.more-files{margin-left:45px}article>.image-entry{margin:8px 0 0 45px}
</style>
