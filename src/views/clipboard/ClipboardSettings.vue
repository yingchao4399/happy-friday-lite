<template>
  <FridayDialog :visible="visible" :title="t('clipboard.settings')" :close-label="t('clipboard.close')" @close="!saving && $emit('close')">
    <p v-if="loading" class="status" role="status">{{ t('clipboard.loading') }}</p>
    <FridayNotice v-if="error" error>{{ error }}</FridayNotice>
    <template v-if="draft">
      <h3>{{ t('clipboard.captureGroup') }}</h3>
      <FridayNotice v-if="draft.capabilities && !draft.capabilities.externalCapture" class="deferred-notice">{{ t('clipboard.externalDeferred') }}</FridayNotice>
      <div class="behavior-panel">
        <label v-for="key in toggleKeys" :key="key" class="setting-row"><span class="setting-text"><span class="setting-label">{{ t('clipboard.' + key) }}</span><span class="setting-hint">{{ t('clipboard.' + key + 'Hint') }}</span></span><input v-model="draft[key]" class="toggle" type="checkbox" role="switch" :disabled="saving" /></label>
      </div>
      <template v-if="draft.capabilities?.recordingCapture">
      <h3>{{ t('clipboard.recordingGroup') }}</h3>
      <FridayNotice v-if="recordingProblem" error>{{ recordingProblem }}</FridayNotice>
      <div class="behavior-panel">
        <label class="setting-row"><span class="setting-text"><span class="setting-label">{{ t('clipboard.captureRecordings') }}</span><span class="setting-hint">{{ t('clipboard.captureRecordingsHint') }}</span></span><input v-model="draft.captureRecordings" class="toggle" type="checkbox" role="switch" :disabled="saving" /></label>
        <div class="recording-folders"><span class="setting-hint">{{ t('clipboard.defaultRecordingFolders') }}</span><p v-for="folder in defaultFolders" :key="folder">{{ folder }}</p><div v-for="(folder, index) in draft.recordingFolders" :key="folder" class="folder-setting"><span>{{ folder }}</span><FridayButton compact variant="text" :disabled="saving" :aria-label="t('clipboard.removeRecordingFolder') + ': ' + folder" @click="draft.recordingFolders.splice(index, 1)"><X :size="14" /></FridayButton></div><FridayButton compact :disabled="saving || choosingFolder || draft.recordingFolders.length >= 12" @click="addRecordingFolder"><FolderPlus :size="14" />{{ t('clipboard.addRecordingFolder') }}</FridayButton><p class="setting-hint">{{ t('clipboard.recordingFolderHint') }}</p></div>
      </div>
      </template>
      <h3>{{ t('clipboard.storageGroup') }}</h3>
      <div class="behavior-panel">
        <div class="setting-row"><span class="setting-text"><span class="setting-label">{{ t('clipboard.retentionDays') }}</span><span class="setting-hint">{{ t('clipboard.retentionHint') }}</span></span><FridaySelect v-model="draft.retentionDays" :options="retentionOptions" :disabled="saving" :label="t('clipboard.retentionDays')" /></div>
        <div class="setting-row"><span class="setting-text"><span class="setting-label">{{ t('clipboard.maxItems') }}</span><span class="setting-hint">{{ t('clipboard.limitHint') }}</span></span><FridaySelect v-model="draft.maxItems" :options="limitOptions" :disabled="saving" :label="t('clipboard.maxItems')" /></div>
        <div class="setting-row"><span class="setting-text"><span class="setting-label">{{ t('clipboard.sensitiveMinutes') }}</span><span class="setting-hint">{{ t('clipboard.sensitiveHint') }}</span></span><FridaySelect v-model="draft.sensitiveMinutes" :options="expiryOptions" :disabled="saving" :label="t('clipboard.sensitiveMinutes')" /></div>
      </div>
      <template v-if="draft.capabilities?.globalShortcut"><h3>{{ t('clipboard.shortcutGroup') }}</h3>
      <div class="behavior-panel"><label class="setting-row"><span class="setting-text"><span class="setting-label">{{ t('clipboard.shortcutEnabled') }}</span><span class="setting-hint">{{ t('clipboard.shortcutHint') }}</span></span><input v-model="draft.shortcutEnabled" class="toggle" type="checkbox" role="switch" :disabled="saving" /></label><div class="setting-row"><span class="setting-label">{{ t('clipboard.shortcut') }}</span><FridaySelect v-model="draft.shortcut" :options="shortcutOptions" :disabled="saving || !draft.shortcutEnabled" :label="t('clipboard.shortcut')" /></div></div></template>
      <h3>{{ t('clipboard.aiGroup') }}</h3>
      <div class="behavior-panel">
        <label class="setting-row"><span class="setting-text"><span class="setting-label">{{ t('clipboard.aiEnabled') }}</span><span class="setting-hint">{{ t('clipboard.aiEnabledHint') }}</span></span><input v-model="draft.aiEnabled" class="toggle" type="checkbox" role="switch" :disabled="saving" /></label>
        <div class="setting-row"><span class="setting-label">{{ t('clipboard.aiModel') }}</span><FridaySelect v-model="draft.aiModelId" :options="modelOptions" :disabled="saving" :label="t('clipboard.aiModel')" /></div>
        <div class="setting-row"><span class="setting-text"><span class="setting-label">{{ t('clipboard.aiTranscriptionModel') }}</span><span class="setting-hint">{{ t('clipboard.aiTranscriptionHint') }}</span></span><FridaySelect v-model="draft.aiTranscriptionModelId" :options="transcriptionOptions" :disabled="saving" :label="t('clipboard.aiTranscriptionModel')" /></div>
        <div class="setting-row"><span class="setting-label">{{ t('clipboard.aiNotebook') }}</span><FridaySelect v-model="draft.aiNotebookId" :options="notebookOptions" :disabled="saving" :label="t('clipboard.aiNotebook')" /></div>
        <div class="setting-row"><span class="setting-label">{{ t('clipboard.aiThreshold') }}</span><FridaySelect v-model="draft.aiThreshold" :options="thresholdOptions" :disabled="saving" :label="t('clipboard.aiThreshold')" /></div>
        <label class="setting-row instructions"><span class="setting-label">{{ t('clipboard.aiInstructions') }}</span><textarea v-model="draft.aiInstructions" maxlength="500" rows="3" :disabled="saving" :placeholder="t('clipboard.aiInstructionsHint')" /></label>
      </div>
      <p class="privacy-note">{{ t('clipboard.protectionHint') }}</p>
      <div class="setting-row clear-row"><span class="setting-text"><span class="setting-label">{{ t('clipboard.clearHistory') }}</span><span class="setting-hint">{{ t('clipboard.clearHint') }}</span></span><FridayButton variant="danger" compact :disabled="saving" @click="confirmClear = true">{{ t('clipboard.clearHistory') }}</FridayButton></div>
      <p v-if="notice" class="status" role="status">{{ notice }}</p>
    </template>
    <template #footer><FridayButton :disabled="saving" @click="$emit('close')">{{ t('clipboard.cancel') }}</FridayButton><FridayButton variant="primary" :disabled="loading || saving || !draft" @click="save">{{ saving ? t('clipboard.saving') : t('clipboard.saveSettings') }}</FridayButton></template>
  </FridayDialog>
  <FridayConfirmDialog :visible="confirmClear" :title="t('clipboard.clearHistory')" :message="t('clipboard.clearConfirm')" :cancel-label="t('clipboard.cancel')" :confirm-label="t('clipboard.clearHistory')" @cancel="confirmClear = false" @confirm="clearHistory" />
</template>
<script setup>
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { FolderPlus, X } from 'lucide-vue-next'
import FridayDialog from '@/components/ui/FridayDialog.vue'
import FridayButton from '@/components/ui/FridayButton.vue'
import FridayNotice from '@/components/ui/FridayNotice.vue'
import FridaySelect from '@/components/ui/FridaySelect.vue'
import FridayConfirmDialog from '@/components/ui/FridayConfirmDialog.vue'
import { electronService } from '@/services/electron'
const props = defineProps({ visible: Boolean })
const emit = defineEmits(['close', 'changed'])
const { t } = useI18n()
const draft = ref(null), loading = ref(false), saving = ref(false), error = ref(''), notice = ref(''), confirmClear = ref(false)
const defaultFolders = ref([]), choosingFolder = ref(false)
const recordingProblem = ref('')
const toggleKeys = ['captureEnabled', 'captureImages', 'captureSensitive']
const aiOptions = ref({ models: [], notebooks: [] })
const modelOptions = computed(() => [{ value: '', label: t('clipboard.defaultModel') }, ...aiOptions.value.models.map(model => ({ value: model.id, label: model.name }))])
const transcriptionOptions = computed(() => [{ value: 'windows-local', label: t('clipboard.localTranscription') }, ...(aiOptions.value.transcriptionModels || []).map(model => ({ value: model.id, label: model.name }))])
const notebookOptions = computed(() => [{ value: '', label: t('clipboard.allNotes') }, ...aiOptions.value.notebooks.map(book => ({ value: book.id, label: book.name }))])
const thresholdOptions = computed(() => [0.6, 0.8, 0.9].map(value => ({ value, label: t('clipboard.thresholdValue', { count: value * 100 }) })))
const retentionOptions = computed(() => [0, 1, 7, 30, 90].map(value => ({ value, label: value ? t('clipboard.days', { count: value }) : t('clipboard.forever') })))
const limitOptions = computed(() => [100, 500, 1000, 2000].map(value => ({ value, label: t('clipboard.itemCount', { count: value }) })))
const expiryOptions = computed(() => [1, 5, 15].map(value => ({ value, label: t('clipboard.minutes', { count: value }) })))
const shortcutOptions = ['CommandOrControl+Shift+V', 'CommandOrControl+Alt+V', 'Alt+Shift+V'].map(value => ({ value, label: value.replace('CommandOrControl', 'Ctrl').replaceAll('+', ' + ') }))
watch(() => props.visible, async visible => {
  if (!visible) { confirmClear.value = false; return }
  loading.value = true; draft.value = null; error.value = ''; notice.value = ''
  try { const [result, options] = await Promise.all([electronService.getClipboardSettings(), electronService.getClipboardAiOptions()]); const { shortcutRegistered, defaultRecordingFolders, recordingIssue, capabilities, ...settings } = result; recordingProblem.value = recordingIssue ? t('clipboard.recordingErrors.' + recordingIssue.code, t('clipboard.recordingCaptureFailed')) : ''; defaultFolders.value = defaultRecordingFolders || []; draft.value = { ...settings, capabilities }; aiOptions.value = options; if (settings.shortcutEnabled && !shortcutRegistered) notice.value = t('clipboard.shortcutUnavailable') }
  catch { error.value = t('clipboard.settingsLoadFailed') }
  finally { loading.value = false }
})
async function addRecordingFolder() {
  choosingFolder.value = true; error.value = ''
  try {
    const folder = await electronService.request('open-file-dialog', { properties: ['openDirectory'] })
    if (folder && !draft.value.recordingFolders.includes(folder) && !defaultFolders.value.includes(folder)) draft.value.recordingFolders.push(folder)
  } catch { error.value = t('clipboard.recordingFolderFailed') }
  finally { choosingFolder.value = false }
}
async function save() {
  saving.value = true; error.value = ''
  try { const { capabilities, ...settings } = draft.value; await electronService.saveClipboardSettings({ ...settings, recordingFolders: [...draft.value.recordingFolders] }); emit('changed'); emit('close') }
  catch (e) { error.value = e.message?.includes('CLIPBOARD_SHORTCUT_UNAVAILABLE') ? t('clipboard.shortcutUnavailable') : e.message?.includes('CLIPBOARD_AI_TRANSCRIPTION_MODEL_REQUIRED') ? t('clipboard.aiErrors.CLIPBOARD_AI_TRANSCRIPTION_MODEL_REQUIRED') : e.message?.includes('CLIPBOARD_AI_MODEL_REQUIRED') ? t('clipboard.aiErrors.CLIPBOARD_AI_MODEL_REQUIRED') : e.message?.includes('CLIPBOARD_NOTEBOOK_MISSING') ? t('clipboard.aiErrors.CLIPBOARD_NOTEBOOK_MISSING') : t('clipboard.settingsSaveFailed') }
  finally { saving.value = false }
}
async function clearHistory() {
  confirmClear.value = false; saving.value = true; error.value = ''
  try { const result = await electronService.clearClipboardHistory(); notice.value = t('clipboard.historyCleared', { count: result.count }); emit('changed') }
  catch { error.value = t('clipboard.clearFailed') }
  finally { saving.value = false }
}
</script>
<style scoped>
.recording-folders{padding:14px 18px}.recording-folders p,.folder-setting{font-size:12px;line-height:1.6;overflow-wrap:anywhere;color:var(--text-secondary)}.folder-setting{display:flex;align-items:center;gap:8px}.folder-setting span{flex:1;min-width:0}
.instructions{align-items:stretch;flex-direction:column;gap:10px}.instructions textarea{width:100%;box-sizing:border-box;padding:10px;border:1px solid var(--border-color);border-radius:7px;background:var(--bg-primary);color:var(--text-primary);font:inherit;font-size:13px;line-height:1.6;resize:vertical}
h3{font-size:12px;font-weight:500;color:var(--text-tertiary);margin:20px 0 10px}h3:first-of-type{margin-top:0}.behavior-panel{background:var(--bg-secondary);border:1px solid var(--border-color);border-radius:10px}.setting-row{display:flex;justify-content:space-between;align-items:center;gap:20px;padding:16px 18px}.setting-row+.setting-row{border-top:1px solid var(--border-color)}.setting-text{display:flex;flex-direction:column;gap:5px;min-width:0}.setting-label{font-size:13px;font-weight:500;color:var(--text-primary)}.setting-hint{font-size:12px;line-height:1.5;color:var(--text-tertiary)}.setting-row :deep(.friday-select){flex-shrink:0;min-width:130px}.toggle{appearance:none;flex-shrink:0;width:36px;height:20px;background:var(--border-color);border-radius:10px;position:relative;cursor:pointer;transition:background .2s}.toggle:before{content:'';position:absolute;top:3px;left:3px;width:14px;height:14px;border-radius:50%;background:var(--bg-primary);box-shadow:0 1px 3px rgba(0,0,0,.15);transition:transform .2s}.toggle:checked{background:var(--text-primary)}.toggle:checked:before{transform:translateX(16px)}.toggle:focus-visible{outline:2px solid var(--accent-color);outline-offset:3px}.toggle:disabled{opacity:.45;cursor:default}.privacy-note,.status{font-size:12px;color:var(--text-secondary);line-height:1.6;margin:14px 0}.clear-row{padding:16px 0 0}@media(max-width:500px){.setting-row{padding:13px;gap:12px;flex-wrap:wrap}.setting-text{flex:1 1 190px}}
</style>
