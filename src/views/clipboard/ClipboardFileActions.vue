<template>
  <FridayDialog :visible="visible" :title="t(mode === 'folder' ? 'clipboard.openFolder' : 'clipboard.openFile')" :close-label="t('clipboard.close')" @close="$emit('close')">
    <FridayNotice v-if="error" error>{{ error }}</FridayNotice>
    <div v-for="(file, index) in item?.filePaths || []" :key="file" class="file-row"><span>{{ file }}</span><FridayButton compact :disabled="busy" @click="open(index)">{{ t(mode === 'folder' ? 'clipboard.openFolder' : 'clipboard.openFile') }}</FridayButton></div>
    <template #footer><FridayButton @click="$emit('close')">{{ t('clipboard.close') }}</FridayButton></template>
  </FridayDialog>
</template>
<script setup>
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import FridayDialog from '@/components/ui/FridayDialog.vue'
import FridayButton from '@/components/ui/FridayButton.vue'
import FridayNotice from '@/components/ui/FridayNotice.vue'
import { electronService } from '@/services/electron'
const props = defineProps({ visible: Boolean, item: Object, mode: String })
const emit = defineEmits(['close'])
const { t } = useI18n()
const busy = ref(false), error = ref('')
watch(() => props.visible, () => { error.value = '' })
async function open(index) {
  busy.value = true; error.value = ''
  try { await electronService.request('clipboard-file-open', { id: props.item.id, index, mode: props.mode }); emit('close') }
  catch { error.value = t('clipboard.fileOpenFailed') }
  finally { busy.value = false }
}
</script>
<style scoped>
.file-row{display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid var(--border-color)}.file-row span{flex:1;min-width:0;overflow-wrap:anywhere;color:var(--text-primary);font-size:13px}
</style>
