<template>
  <div class="ai-tools-content">
    <p class="item-hint shared-hint">{{ t('office.services.sharedCredentials') }}</p>
    <form v-if="settings" @submit.prevent="save">
      <div class="actions">
        <button type="button" class="tool-button" :disabled="busy" @click="testConnection">{{ t('office.services.testConnection') }}</button>
        <button type="submit" class="tool-button primary" :disabled="busy">{{ t('office.services.save') }}</button>
      </div>
      <div class="settings-group">
        <div class="group-title">{{ t('office.services.search') }}</div>
        <div class="group-content">
          <div class="setting-item"><label class="item-label" for="tool-search-provider">{{ t('office.services.provider') }}</label><select id="tool-search-provider" v-model="settings.search.provider" class="tool-input"><option v-for="provider in settings.catalog.search" :key="provider.id" :value="provider.id">{{ provider.label }}</option></select></div>
          <template v-if="settings.search.provider !== 'genspark'">
            <div class="setting-item"><label class="item-label" for="tool-search-key">{{ t('office.services.key') }}</label><input id="tool-search-key" v-model="searchDraft.apiKey" class="tool-input" type="password" autocomplete="new-password" :placeholder="keyPlaceholder(searchDraft)"></div>
            <div v-if="searchDraft.apiKeyConfigured" class="setting-item"><label class="item-hint"><input v-model="searchDraft.clearKey" type="checkbox"> {{ t('office.services.clearKey') }}</label></div>
          </template>
          <div class="setting-item"><span class="item-hint">{{ t('office.services.searchHint') }}</span></div>
        </div>
      </div>
      <div class="settings-group">
        <div class="group-title">{{ t('office.services.localSearch') }}</div>
        <div class="group-content">
          <div class="setting-item"><div class="item-label-group"><span class="item-label">{{ t('office.services.rerank') }}</span><span class="item-hint">{{ t('office.services.rerankHint') }}</span></div><label class="toggle-switch"><input v-model="settings.fileSearch.rerank" type="checkbox"><span class="toggle-slider"></span></label></div>
          <template v-if="settings.fileSearch.rerank">
            <div class="setting-item"><label class="item-label" for="tool-rerank-endpoint">{{ t('office.services.rerankEndpoint') }}</label><select id="tool-rerank-endpoint" v-model="settings.fileSearch.endpoint" class="tool-input"><option v-for="item in settings.catalog.decisionEndpoints" :key="item.id" :value="item.id">{{ item.label }}</option></select></div>
            <div class="setting-item"><label class="item-label" for="tool-rerank-key">{{ t('office.services.key') }}</label><input id="tool-rerank-key" v-model="rerankKeys[settings.fileSearch.endpoint]" class="tool-input" type="password" autocomplete="new-password" :placeholder="t(settings.fileSearch.keysConfigured[settings.fileSearch.endpoint] ? 'office.services.keepKey' : 'office.services.enterKey')"></div>
            <template v-if="settings.fileSearch.endpoint === 'custom'"><div class="setting-item"><label class="item-label" for="tool-rerank-url">{{ t('office.services.baseUrl') }}</label><input id="tool-rerank-url" v-model="settings.fileSearch.customBaseUrl" class="tool-input" type="url"></div><div class="setting-item"><label class="item-label" for="tool-rerank-model">{{ t('office.services.modelId') }}</label><input id="tool-rerank-model" v-model="settings.fileSearch.customModel" class="tool-input"></div></template>
            <template v-if="settings.fileSearch.endpoint.startsWith('cloudflare')"><div class="setting-item"><label class="item-label" for="tool-rerank-account">{{ t('office.services.accountId') }}</label><input id="tool-rerank-account" v-model="settings.fileSearch.cloudflareAccountId" class="tool-input"></div><div class="setting-item"><label class="item-label" for="tool-rerank-cf-model">{{ t('office.services.modelId') }}</label><input id="tool-rerank-cf-model" v-model="settings.fileSearch.cloudflareModel" class="tool-input"></div></template>
          </template>
        </div>
      </div>
      <div v-for="section in mediaSections" :key="section.id" class="settings-group">
        <div class="group-title">{{ t(`office.services.${section.title}`) }}</div>
        <div class="group-content">
          <div class="setting-item"><label class="item-label" :for="`tool-${section.id}-provider`">{{ t('office.services.provider') }}</label><select :id="`tool-${section.id}-provider`" v-model="settings.media[section.field]" class="tool-input"><option v-for="provider in mediaOptions(section)" :key="provider.id" :value="provider.id">{{ provider.label }}</option></select></div>
          <template v-if="settings.media[section.field] !== 'genspark'">
            <div class="setting-item"><label class="item-label" :for="`tool-${section.id}-model`">{{ t('office.services.modelId') }}</label><input :id="`tool-${section.id}-model`" v-model="mediaDraft(section)[section.modelField]" :list="`models-${section.id}`" class="tool-input" :placeholder="mediaMeta(section)[section.modelField === 'imageModel' ? 'defaultImageModel' : 'defaultAnalysisModel']"><datalist :id="`models-${section.id}`"><option v-for="name in mediaMeta(section)[section.modelField === 'imageModel' ? 'imageModels' : 'analysisModels']" :key="name" :value="name" /></datalist></div>
            <div class="setting-item"><label class="item-label" :for="`tool-${section.id}-key`">{{ t('office.services.key') }}</label><input :id="`tool-${section.id}-key`" v-model="mediaDraft(section).apiKey" class="tool-input" type="password" autocomplete="new-password" :placeholder="keyPlaceholder(mediaDraft(section))"></div>
            <div class="setting-item"><label class="item-label" :for="`tool-${section.id}-url`">{{ t('office.services.baseUrl') }}</label><input :id="`tool-${section.id}-url`" v-model="mediaDraft(section).baseUrl" class="tool-input" type="url" :placeholder="mediaMeta(section).defaultBaseUrl"></div>
            <div v-if="mediaDraft(section).apiKeyConfigured" class="setting-item"><label class="item-hint"><input v-model="mediaDraft(section).clearKey" type="checkbox"> {{ t('office.services.clearKey') }}</label></div>
          </template>
          <div v-else class="setting-item"><span class="item-hint">{{ t('office.services.hostedAccountHint') }}</span></div>
        </div>
      </div>
    </form>
    <p class="item-hint" role="status">{{ message }}</p>
    <div v-if="checks.length" class="group-content" aria-live="polite">
      <div v-for="check in checks" :key="check.kind" class="setting-item">
        <span class="item-label">{{ t(`office.services.${check.kind}`) }}</span>
        <span class="item-hint">{{ t(check.skipped ? 'office.services.checkSkipped' : check.ok ? 'office.services.checkPassed' : 'office.services.checkFailed') }}</span>
      </div>
      <div class="setting-item"><span class="item-hint">{{ t('office.services.checkHint') }}</span></div>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { electronService } from '@/services/electron'
const { t } = useI18n()
const settings = ref(null)
const drafts = reactive({ search: {}, media: {} })
const rerankKeys = reactive({})
const busy = ref(false)
const message = ref('')
const checks = ref([])
const mediaSections = [
  { id: 'image', title: 'imageGeneration', field: 'imageProvider', modelField: 'imageModel' },
  { id: 'analysis', title: 'imageAnalysis', field: 'analysisProvider', modelField: 'analysisModel' },
  { id: 'video', title: 'videoAnalysis', field: 'videoAnalysisProvider', modelField: 'analysisModel' },
]
const emptyDraft = () => ({ apiKey: '', apiKeyConfigured: false, clearKey: false, baseUrl: '', imageModel: '', analysisModel: '' })
const searchDraft = computed(() => drafts.search[settings.value?.search.provider] || emptyDraft())
const mediaDraft = section => drafts.media[settings.value.media[section.field]]
const mediaMeta = section => settings.value.catalog.media.find(item => item.id === settings.value.media[section.field]) || {}
const mediaOptions = section => settings.value.catalog.media.filter(item => section.id === 'image' ? item.imageProtocol : section.id === 'video' ? item.analysisProtocol && item.videoAnalysis : item.analysisProtocol)
const keyPlaceholder = draft => t(draft.apiKeyConfigured ? 'office.services.keepKey' : 'office.services.enterKey')
function accept(value) {
  settings.value = value
  for (const kind of ['search', 'media']) for (const provider of value.catalog[kind]) drafts[kind][provider.id] = { ...emptyDraft(), ...value[kind].providers[provider.id] }
  for (const endpoint of value.catalog.decisionEndpoints) rerankKeys[endpoint.id] = ''
}
onMounted(async () => {
  try { accept(await electronService.getOfficeAiServices()) }
  catch { message.value = t('office.services.loadFailed') }
})
function patch() {
  const result = { search: { enabled: true, provider: settings.value.search.provider, providers: {} }, media: { enabled: true, imageProvider: settings.value.media.imageProvider, analysisProvider: settings.value.media.analysisProvider, videoAnalysisProvider: settings.value.media.videoAnalysisProvider, providers: {} }, fileSearch: { ...settings.value.fileSearch, keys: {} } }
  delete result.fileSearch.keysConfigured
  for (const kind of ['search', 'media']) for (const [id, draft] of Object.entries(drafts[kind])) {
    const value = kind === 'media' ? { baseUrl: draft.baseUrl, imageModel: draft.imageModel, analysisModel: draft.analysisModel } : {}
    if (draft.clearKey || draft.apiKey) value.apiKey = draft.clearKey ? '' : draft.apiKey
    result[kind].providers[id] = value
  }
  for (const [id, key] of Object.entries(rerankKeys)) if (key) result.fileSearch.keys[id] = key
  return result
}
async function save() {
  busy.value = true
  try { accept(await electronService.saveOfficeAiServices(patch())); message.value = t('office.services.saved') }
  catch { message.value = t('office.services.saveFailed') }
  finally { busy.value = false }
}
async function testConnection() {
  busy.value = true
  checks.value = []
  try { const result = await electronService.testOfficeAiServices({ kind: 'all', patch: patch() }); checks.value = result.checks || []; message.value = t(result.ok ? 'office.services.connectionPassed' : 'office.services.testFailed') }
  catch { message.value = t('office.services.testFailed') }
  finally { busy.value = false }
}
</script>

<style scoped src="../../views/settings/settings-subpage.css"></style>
<style scoped>
.shared-hint { margin: 0 0 16px; }
.actions { display: flex; justify-content: flex-end; gap: 8px; margin-bottom: 8px; }
.tool-input { width: min(55%, 360px); min-width: 140px; padding: 8px 12px; font-size: 13px; color: var(--text-primary); background: var(--bg-primary); border: 1px solid var(--border-color); border-radius: 6px; outline: none; }
.tool-input:focus { border-color: var(--text-secondary); }
.tool-button { padding: 8px 16px; border: 1px solid var(--border-color); background: var(--bg-secondary); color: var(--text-primary); border-radius: 6px; cursor: pointer; }
.tool-button.primary { background: var(--text-primary); color: var(--bg-primary); }
.tool-button:disabled { opacity: .5; cursor: default; }
</style>
