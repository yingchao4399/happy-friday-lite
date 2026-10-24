<template>
  <FridayPage :title="t('recitation.title')" :description="t('recitation.description')">
    <template #actions>
      <FridayButton v-if="selectedSession" :disabled="editingTranscript" @click="selectedId = ''"><ArrowLeft :size="16" />{{ t('recitation.allSessions') }}</FridayButton>
      <FridayButton variant="primary" :disabled="!!busy || !desktop || editingTranscript" @click="inputRef?.click()"><Upload :size="17" />{{ t('recitation.upload') }}</FridayButton>
    </template>
    <input ref="inputRef" type="file" accept=".mp3,.wav,.m4a,.mpeg,.mpga,.webm,.ogg,.flac,audio/*" hidden @change="importAudio" />
    <FridayNotice v-if="!desktop" class="page-notice">{{ t('recitation.desktopRequired') }}</FridayNotice>
    <FridayNotice v-if="error" class="page-notice" error>{{ error }}<template #action><FridayButton compact variant="text" :disabled="!!busy" @click="refresh">{{ t('recitation.retry') }}</FridayButton></template></FridayNotice>
    <div v-if="busy" class="task-progress" role="status" aria-live="polite"><LoaderCircle :size="16" class="spin" />{{ busy }}<FridayButton v-if="transcribingId" compact variant="text" :disabled="cancelling" @click="cancelTranscription">{{ t('recitation.cancelTranscription') }}</FridayButton></div>
    <template v-if="!selectedSession">
      <div class="list-toolbar">
        <div class="search-box"><Search :size="15" /><input v-model="query" :placeholder="t('recitation.searchPlaceholder')" :aria-label="t('recitation.searchPlaceholder')" /><FridayButton v-if="query" icon-only variant="text" :aria-label="t('recitation.clearSearch')" @click="query = ''"><X :size="13" /></FridayButton></div>
        <span class="list-count">{{ t('recitation.sessionCount', { count: sessions.length }) }}</span>
      </div>
      <div v-if="loading" class="state-wrap"><LoaderCircle :size="28" class="spin state-icon" /><p class="state-text">{{ t('recitation.loading') }}</p></div>
      <div v-else-if="!filteredSessions.length" class="state-wrap">
        <Headphones :size="56" :stroke-width="1.2" class="state-icon" />
        <p class="state-title">{{ query ? t('recitation.noResults') : t('recitation.empty') }}</p>
        <p class="state-text">{{ query ? t('recitation.searchHint') : t('recitation.uploadHint') }}</p>
        <FridayButton v-if="!query" :disabled="!!busy || !desktop" @click="inputRef?.click()"><Upload :size="15" />{{ t('recitation.upload') }}</FridayButton>
      </div>
      <div v-else class="session-list">
        <button v-for="session in filteredSessions" :key="session.id" type="button" class="session-row" @click="openSession(session)">
          <FileAudio :size="19" :stroke-width="1.6" class="row-icon" />
          <div class="row-content"><strong>{{ session.name }}</strong><p>{{ formatDate(session.updatedAt) }}<span v-if="session.transcript"> · {{ t('recitation.characters', { count: session.analysis?.characterCount || session.transcript.length }) }}</span></p></div>
          <span :class="['session-status', session.status]">{{ t(`recitation.status.${session.status}`) }}</span><ChevronRight :size="16" class="row-icon" />
        </button>
      </div>
    </template>
    <template v-else>
      <div class="session-heading"><FileAudio :size="19" :stroke-width="1.6" /><h2>{{ selectedSession.name }}</h2><span :class="['session-status', selectedSession.status]">{{ t(`recitation.status.${selectedSession.status}`) }}</span></div>
      <audio v-if="audioUrl" ref="player" :key="selectedSession.id" controls preload="metadata" :src="audioUrl" :aria-label="selectedSession.name" @error="error = t('recitation.playbackFailed')" />
      <FridayNotice v-if="selectedSession.error" error class="page-notice">{{ recitationError(selectedSession.error) }}</FridayNotice>
      <FridayTabs v-model="activeTab" :tabs="tabs" :label="t('recitation.title')" />
      <section v-if="activeTab === 'transcript'" class="result-section">
        <div class="transcription-controls"><span class="field-label">{{ t('recitation.engine') }}</span><FridaySelect v-model="modelId" :options="engineOptions" :label="t('recitation.engine')" :disabled="!!busy || editingTranscript" /><FridayButton variant="primary" :disabled="!!busy || editingTranscript" @click="transcribe(selectedSession)"><Play :size="15" />{{ t('recitation.transcribe') }}</FridayButton></div>
        <p class="hint engine-hint">{{ t('recitation.engineHint') }}</p>
        <label class="reference-field"><span class="field-label">{{ t('recitation.referenceText') }}</span><textarea v-model="selectedSession.referenceText" rows="3" :placeholder="t('recitation.referencePlaceholder')" /></label>
        <FridayButton v-if="selectedSession.transcript" compact :disabled="!!busy || editingTranscript" @click="reanalyze(selectedSession)"><RefreshCw :size="14" />{{ t('recitation.reanalyze') }}</FridayButton>
        <div v-if="selectedSession.transcript" class="transcription-controls correction-actions">
          <template v-if="editingTranscript"><FridayButton compact variant="primary" :disabled="!!busy" @click="saveTranscript(selectedSession)">{{ t('recitation.saveCorrection') }}</FridayButton><FridayButton compact :disabled="!!busy" @click="editingTranscript = false">{{ t('recitation.cancelCorrection') }}</FridayButton></template>
          <FridayButton v-else compact :disabled="!!busy" @click="beginCorrection(selectedSession)">{{ t('recitation.correctTranscript') }}</FridayButton>
        </div>
        <p v-if="editingTranscript" class="hint">{{ t('recitation.correctionHint') }}</p>
        <div v-if="selectedSession.segments?.length" class="transcript-segments">
          <div v-for="(segment, index) in selectedSession.segments" :key="index" class="segment-row">
            <button type="button" class="timestamp" :aria-label="t('recitation.sourceAudio', { time: formatOffset(segment.start) })" @click="seek(segment.start)">{{ formatOffset(segment.start) }}<Play :size="11" /></button><textarea v-if="editingTranscript" v-model="transcriptDraft[index]" class="correction-text" rows="2" :aria-label="t('recitation.correctSegment', { time: formatOffset(segment.start) })" /><p v-else>{{ segment.text }}<span v-if="segment.corrected" class="corrected-label">{{ t('recitation.manuallyCorrected') }}</span></p><span v-if="typeof segment.confidence === 'number'" :class="['confidence', { low: segment.confidence < .65 }]">{{ t('recitation.segmentConfidence', { value: Math.round(segment.confidence * 100) }) }}</span>
          </div>
        </div>
        <textarea v-else-if="editingTranscript" v-model="transcriptDraft[0]" class="correction-text" rows="8" :aria-label="t('recitation.correctTranscript')" />
        <p v-else-if="selectedSession.transcript" class="transcript">{{ selectedSession.transcript }}</p>
        <details v-if="selectedSession.rawTranscript && selectedSession.rawTranscript !== selectedSession.transcript" class="original-transcript"><summary>{{ t('recitation.rawTranscript') }}</summary><p class="transcript">{{ selectedSession.rawTranscript }}</p><p class="hint">{{ t('recitation.correctedAnalysisHint') }}</p></details>
        <div v-if="!selectedSession.transcript && !editingTranscript" class="state-wrap compact-state"><AudioLines :size="40" :stroke-width="1.2" class="state-icon" /><p class="state-text">{{ t('recitation.startHint') }}</p></div>
      </section>
      <section v-else-if="activeTab === 'analysis' && selectedSession.analysis" class="result-section">
        <ul class="analysis-metrics"><li v-for="(metric, index) in analysisMetrics" :key="index">{{ metric }}</li></ul>
        <p class="hint">{{ t('recitation.repetitionUnknown') }}</p><p class="hint">{{ t('recitation.extractionHint') }}</p>
        <div v-if="selectedSession.study" class="study-summary"><h3>{{ selectedSession.study.title }}</h3><p class="hint">{{ t('recitation.keywords') }}{{ selectedSession.study.keywords.join('、') }}</p><ul><li v-for="point in selectedSession.study.points" :key="point.id">{{ point.text }}</li></ul></div>
      </section>
      <section v-else-if="activeTab === 'practice' && selectedSession.study" class="result-section">
        <h3>{{ t('recitation.reviewPlan') }}</h3><ol class="review-plan"><li v-for="step in selectedSession.study.plan" :key="step.afterHours"><span>{{ t('recitation.afterHours', { count: step.afterHours }) }}</span><p>{{ t(`recitation.planActions.${step.action}`) }}</p></li></ol>
        <h3>{{ t('recitation.exercises') }}</h3><p class="hint">{{ t('recitation.extractionHint') }}</p>
        <article v-for="(question, index) in selectedSession.study.questions" :key="index" class="exercise"><div class="exercise-heading"><span class="question-number">{{ index + 1 }}</span><strong>{{ t(`recitation.questionTypes.${question.type}`) }}</strong></div><p>{{ question.type === 'recall' ? t('recitation.recallPrompt', { text: question.prompt }) : question.prompt }}</p><ol v-if="question.options" type="A"><li v-for="option in question.options" :key="option">{{ option }}</li></ol><details><summary>{{ t('recitation.showAnswer') }}</summary><p>{{ question.answer }}</p></details><FridayButton v-if="typeof question.source?.start === 'number'" compact variant="text" @click="seek(question.source.start)"><Play :size="13" />{{ t('recitation.sourceAudio', { time: formatOffset(question.source.start) }) }}</FridayButton><details v-else><summary>{{ t('recitation.sourceText') }}</summary><p>{{ question.source?.text }}</p></details></article>
      </section>
      <div v-else class="state-wrap"><AudioLines :size="40" :stroke-width="1.2" class="state-icon" /><p class="state-text">{{ t('recitation.resultsPending') }}</p><FridayButton @click="activeTab = 'transcript'">{{ t('recitation.transcriptTab') }}</FridayButton></div>
    </template>
  </FridayPage>
</template>

<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ArrowLeft, AudioLines, ChevronRight, FileAudio, Headphones, LoaderCircle, Play, RefreshCw, Search, Upload, X } from 'lucide-vue-next'
import FridayButton from '@/components/ui/FridayButton.vue'
import FridayNotice from '@/components/ui/FridayNotice.vue'
import FridayPage from '@/components/ui/FridayPage.vue'
import FridaySelect from '@/components/ui/FridaySelect.vue'
import FridayTabs from '@/components/ui/FridayTabs.vue'
import { electronService } from '@/services/electron'
const { t, te } = useI18n()
const desktop = electronService.isElectron
const inputRef = ref(null)
const sessions = ref([])
const loading = ref(false)
const selectedId = ref('')
const query = ref('')
const busy = ref('')
const transcribingId = ref('')
const cancelling = ref(false)
const error = ref('')
const modelId = ref('windows-local')
const models = ref([])
const player = ref(null)
const audioUrl = ref('')
const activeTab = ref('transcript')
const editingTranscript = ref(false)
const transcriptDraft = ref([])
const correctionRevision = ref('')
const selectedSession = computed(() => sessions.value.find(session => session.id === selectedId.value))
const filteredSessions = computed(() => sessions.value.filter(session => session.name.toLocaleLowerCase().includes(query.value.trim().toLocaleLowerCase())))
const engineOptions = computed(() => [{ value: 'windows-local', label: t('recitation.localEngine') }, ...models.value.map(model => ({ value: model.id, label: model.name }))])
const tabs = computed(() => [{ key: 'transcript', label: t('recitation.transcriptTab') }, { key: 'analysis', label: t('recitation.analysisTab') }, { key: 'practice', label: t('recitation.practiceTab') }])
const analysisMetrics = computed(() => {
  const session = selectedSession.value
  const analysis = session?.analysis
  if (!analysis) return []
  return [t('recitation.characters', { count: analysis.characterCount }), analysis.pacePerMinute != null ? t('recitation.pace', { count: analysis.pacePerMinute }) : null, t('recitation.pauses', { count: analysis.pauseCount }), t('recitation.voiced', { count: analysis.voicedSeconds }), t('recitation.repetitions', { count: analysis.repeatedSegments?.length || 0 }), typeof analysis.confidence === 'number' ? t('recitation.confidence', { value: Math.round(analysis.confidence * 100) + '%' }) : t('recitation.confidenceUnknown'), analysis.alignment?.status === 'aligned' ? t('recitation.accuracy', { value: Math.round(analysis.alignment.accuracy * 100) }) : analysis.alignment?.status === 'too_long' ? t('recitation.alignmentTooLong') : t('recitation.noAccuracy')].filter(Boolean)
})
watch(selectedId, async (id, _previous, onCleanup) => {
  let cancelled = false, objectUrl = ''
  audioUrl.value = ''
  onCleanup(() => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl) })
  if (!id) return
  try {
    const asset = await electronService.request('recitation-audio', { id })
    if (!cancelled) { objectUrl = URL.createObjectURL(new Blob([asset.bytes], { type: asset.mime })); audioUrl.value = objectUrl }
  } catch { if (!cancelled) error.value = t('recitation.playbackFailed') }
})
const formatOffset = value => { const seconds = Math.max(0, Math.floor(Number(value) || 0)); return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}` }
const formatDate = value => value ? new Date(value).toLocaleString() : ''
function openSession(session) { selectedId.value = session.id; activeTab.value = 'transcript'; error.value = '' }
function recitationError(error) {
  const message = typeof error === 'string' ? error : error.message || String(error)
  const code = error.code || message.match(/(?:RECITATION|MEDIA_TRANSCRIPTION)_[A-Z_]+/)?.[0]
  return code && te(`recitation.errors.${code}`) ? t(`recitation.errors.${code}`) : message
}
function beginCorrection(session) {
  transcriptDraft.value = session.segments?.length ? session.segments.map(segment => segment.text) : [session.transcript]
  correctionRevision.value = session.updatedAt
  editingTranscript.value = true
}
async function saveTranscript(session) {
  busy.value = t('recitation.savingCorrection'); error.value = ''
  try {
    await electronService.request('recitation-correct', { id: session.id, texts: transcriptDraft.value, expectedUpdatedAt: correctionRevision.value, referenceText: session.referenceText || '' })
    editingTranscript.value = false; await load()
  } catch (e) {
    error.value = recitationError(e)
  } finally { busy.value = '' }
}
async function seek(seconds) {
  if (!player.value) return
  try { player.value.currentTime = Math.max(0, Number(seconds) || 0); await player.value.play() } catch { error.value = t('recitation.playbackFailed') }
}
async function load() {
  const references = new Map(sessions.value.map(session => [session.id, session.referenceText]))
  sessions.value = (await electronService.request('recitation-list') || []).map(session => ({ ...session, referenceText: references.has(session.id) ? references.get(session.id) : session.referenceText || '' }))
}
async function refresh() {
  if (!desktop) return
  loading.value = true; error.value = ''
  try { await load(); models.value = await electronService.request('recitation-models') || [] } catch (e) { error.value = e.message || String(e) } finally { loading.value = false }
}
async function importAudio(event) {
  const file = event.target.files?.[0]
  if (!file || !desktop) return
  busy.value = t('recitation.importing'); error.value = ''
  try { const filePath = window.electronAPI.getPathForFile(file); const result = await electronService.request('recitation-import', { filePath }); await load(); if (result?.id) openSession(result) } catch (e) { error.value = e.message || String(e) } finally { busy.value = ''; event.target.value = '' }
}
async function transcribe(session) {
  busy.value = t('recitation.transcribing'); error.value = ''
  transcribingId.value = session.id; cancelling.value = false
  try { await electronService.request('recitation-transcribe', { id: session.id, modelId: modelId.value, referenceText: session.referenceText || '' }); await load(); activeTab.value = 'analysis' } catch (e) { error.value = recitationError(e); await load().catch(() => {}) } finally { busy.value = ''; transcribingId.value = ''; cancelling.value = false }
}
async function cancelTranscription() {
  if (!transcribingId.value || cancelling.value) return
  cancelling.value = true; busy.value = t('recitation.cancelling')
  try { await electronService.request('recitation-cancel', { id: transcribingId.value }) }
  catch (e) { cancelling.value = false; error.value = recitationError(e) }
}
async function reanalyze(session) {
  busy.value = t('recitation.analyzing'); error.value = ''
  try { await electronService.request('recitation-analyze', { id: session.id, referenceText: session.referenceText || '' }); await load(); activeTab.value = 'analysis' } catch (e) { error.value = e.message || String(e) } finally { busy.value = '' }
}
let unlistenProgress
onMounted(() => {
  unlistenProgress = electronService.listen('task-progress', ({ payload }) => {
    if (payload.kind !== 'recitation' || payload.id !== transcribingId.value || cancelling.value) return
    if (te(`recitation.stages.${payload.stage}`)) busy.value = t(`recitation.stages.${payload.stage}`)
  })
  refresh()
})
onUnmounted(() => { unlistenProgress?.() })
</script>

<style scoped>
.page-notice{margin-top:20px}.task-progress{display:flex;align-items:center;gap:8px;margin-top:18px;color:var(--text-secondary);font-size:13px}.spin{animation:spin .7s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}
.correction-actions{margin-top:16px}.correction-text{width:100%;padding:10px 12px;resize:vertical;border:1px solid var(--border-color);border-radius:8px;background:var(--bg-primary);color:var(--text-primary);font:inherit;line-height:1.65}.correction-text:focus{outline:0;border-color:var(--text-tertiary);box-shadow:0 0 0 3px var(--bg-hover)}.corrected-label{margin-left:8px;color:var(--text-tertiary);font-size:11px}.original-transcript{margin-top:20px;font-size:12px;color:var(--text-secondary)}.original-transcript summary{cursor:pointer}
.list-toolbar{display:flex;align-items:center;gap:16px;margin-top:26px}.search-box{display:flex;align-items:center;gap:8px;width:320px;max-width:100%;padding:9px 14px;background:var(--bg-secondary);border:1.5px solid transparent;border-radius:10px;transition:all .2s ease;color:var(--text-tertiary)}.search-box:focus-within{border-color:var(--border-color);background:var(--bg-primary);box-shadow:0 0 0 3px var(--accent-light)}.search-box input{flex:1;min-width:0;border:0;outline:0;background:transparent;color:var(--text-primary);font:inherit;font-size:13.5px}.search-box input::placeholder{color:var(--text-tertiary)}.list-count{font-size:12px;color:var(--text-tertiary);white-space:nowrap}
.state-wrap{display:flex;flex-direction:column;align-items:center;justify-content:center;padding:80px 0;gap:12px;text-align:center}.state-icon{color:var(--text-tertiary);opacity:.5}.state-title{font-size:15px;font-weight:600;color:var(--text-secondary)}.state-text{font-size:13px;color:var(--text-tertiary);line-height:1.6}.compact-state{padding:46px 0}
.session-list{display:flex;flex-direction:column;margin-top:20px}.session-row{display:flex;align-items:center;gap:14px;padding:14px 12px;border-radius:10px;cursor:pointer;transition:all .15s ease;border:1px solid transparent;width:100%;text-align:left;color:var(--text-primary);background:transparent;font:inherit}.session-row:hover{background:var(--bg-secondary);border-color:var(--border-color)}.session-row:active{background:var(--bg-active)}.row-icon{color:var(--text-tertiary);flex-shrink:0}.row-content{flex:1;min-width:0}.row-content strong{display:block;font-size:14px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;line-height:22px}.row-content p{margin-top:4px;font-size:12.5px;color:var(--text-tertiary)}
.session-status{padding:2px 6px;border-radius:4px;background:var(--bg-secondary);color:var(--text-secondary);font-size:11px;line-height:1.35;flex-shrink:0}.session-status.analyzed{background:rgba(100,166,126,.13);color:#3c8056}.session-status.error{background:rgba(217,84,77,.12);color:#bf433d}.session-status.transcribing{background:rgba(79,143,202,.12);color:#3577b2}.session-heading{display:flex;align-items:center;gap:10px;margin:28px 0 14px}.session-heading>svg{color:var(--text-tertiary);flex-shrink:0}.session-heading h2{font-size:15px;font-weight:600;word-break:break-word}
audio{width:100%;max-width:720px;height:40px;display:block}:global([data-theme='dark']) audio{color-scheme:dark}.result-section{margin-top:22px;max-width:960px;font-size:13px;line-height:1.65}.transcription-controls{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.field-label{font-size:13.5px;font-weight:600}.hint{color:var(--text-tertiary);font-size:12px;line-height:1.6;margin:12px 0}.engine-hint{max-width:720px}.reference-field{display:flex;flex-direction:column;gap:8px;margin:20px 0 10px;max-width:720px}.reference-field textarea{width:100%;resize:vertical;padding:10px 12px;border:1px solid var(--border-color);border-radius:8px;background:var(--bg-primary);color:var(--text-primary);font:inherit;outline:0;transition:border-color .15s ease,box-shadow .15s ease}.reference-field textarea:focus{border-color:var(--text-tertiary);box-shadow:0 0 0 3px var(--bg-hover)}.reference-field textarea::placeholder{color:var(--text-tertiary)}
.transcript-segments{margin-top:24px}.segment-row{display:grid;grid-template-columns:65px minmax(0,1fr) auto;align-items:start;gap:14px;padding:13px 0;border-bottom:1px solid var(--border-color)}.segment-row p,.transcript,.exercise p,.study-summary li{user-select:text;-webkit-user-select:text}.timestamp{display:flex;align-items:center;gap:5px;padding:4px 2px;border:0;border-radius:4px;color:var(--text-secondary);font:inherit;font-size:12px;background:transparent;cursor:pointer;font-variant-numeric:tabular-nums;transition:background-color .15s ease}.timestamp:hover{background:var(--bg-hover)}.confidence{color:var(--text-tertiary);font-size:11px;padding-top:3px}.confidence.low{color:#bf7c33}.transcript{white-space:pre-wrap;margin-top:24px}
.analysis-metrics{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,280px),1fr));column-gap:24px;max-width:760px;list-style:none;margin:0;padding:0}.analysis-metrics li{min-width:0;padding:9px 0;border-bottom:1px solid var(--border-color);overflow-wrap:anywhere}.study-summary{margin-top:28px}.result-section h3{font-size:14px;font-weight:600}.study-summary ul,.exercise ol{padding-left:22px;margin-top:12px}.study-summary li{margin:6px 0}.review-plan{list-style:none;padding:0;margin:12px 0 28px}.review-plan li{display:flex;gap:18px;padding:12px 0;border-bottom:1px solid var(--border-color)}.review-plan li>span{min-width:72px;font-size:12px;color:var(--text-tertiary);padding-top:2px}.exercise{border-bottom:1px solid var(--border-color);padding:18px 0}.exercise-heading{display:flex;align-items:center;gap:8px;margin-bottom:10px}.exercise-heading strong{font-size:13px}.question-number{background:var(--bg-secondary);color:var(--text-secondary);border-radius:6px;width:24px;height:24px;display:inline-flex;align-items:center;justify-content:center;font-size:12px}.exercise details{margin-top:12px;color:var(--text-secondary)}.exercise summary{cursor:pointer;font-size:12px}.exercise details p{margin:8px 0}
@media(max-width:640px){.list-toolbar{flex-wrap:wrap}.segment-row{grid-template-columns:60px minmax(0,1fr)}.confidence{grid-column:2}.review-plan li{gap:10px}}
</style>
