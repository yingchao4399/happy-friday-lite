<template>
  <NodeViewWrapper class="note-chart-node" :class="{ selected }" :style="wrapperStyle" @mousedown="selectNode" @click.stop="selectNode" @dblclick.stop="openEditor">
    <div contenteditable="false">
      <div v-if="config.title && !tableLike" class="note-chart-title">{{ config.title }}</div>
      <NoteChartCanvas :config="config" />
      <div v-if="editable" class="chart-node-actions">
        <button type="button" :title="t('note.chart.edit')" @click.stop="openEditor"><Pencil :size="14" /></button>
        <button type="button" :title="t('note.chart.responsive')" @click.stop="updateAttributes({ responsive: true })"><Maximize2 :size="14" /></button>
      </div>
      <span v-if="editable" class="chart-resize-handle" :class="{ active: selected }" :title="t('note.chart.resize')" @pointerdown.prevent.stop="beginResize" />
    </div>
    <FridayDialog :visible="editing" :title="t('note.chart.edit')" :close-label="t('note.cancel')" wide @close="editing = false">
      <div class="chart-editor-layout" contenteditable="false" @dblclick.stop>
        <aside class="chart-settings">
          <label>{{ t('note.chart.type') }}<select v-model="draft.kind" data-chart-input="kind"><option v-for="kind in chartKinds" :key="kind" :value="kind">{{ t(`note.chart.kinds.${kind}`) }}</option></select></label>
          <label>{{ t('note.chart.title') }}<input v-model="draft.title" type="text" data-chart-input="title" /></label>
          <label>{{ t('note.chart.color') }}<input v-model="draft.color" type="color" /></label>
          <div class="chart-size-fields"><label>{{ t('note.chart.width') }}<input v-model.number="draft.width" type="number" min="240" max="1600" /></label><label>{{ t('note.chart.height') }}<input v-model.number="draft.height" type="number" min="160" max="1000" /></label></div>
          <label>{{ t('note.chart.alignment') }}<select v-model="draft.align"><option v-for="alignment in ['left','center','right']" :key="alignment" :value="alignment">{{ t(`note.chart.align.${alignment}`) }}</option></select></label>
          <label v-if="draft.kind === 'histogram'">{{ t('note.chart.bins') }}<input v-model.number="draft.bins" type="number" min="0" max="100" /></label>
          <template v-if="hasAxes"><label>{{ t('note.chart.xTitle') }}<input v-model="draft.xTitle" type="text" /></label><label>{{ t('note.chart.yTitle') }}<input v-model="draft.yTitle" type="text" /></label></template>
          <label class="check"><input v-model="draft.responsive" type="checkbox" />{{ t('note.chart.responsive') }}</label>
          <label class="check"><input v-model="draft.showGrid" type="checkbox" />{{ t('note.chart.showGrid') }}</label>
          <label class="check"><input v-model="draft.showLabels" type="checkbox" />{{ t('note.chart.showLabels') }}</label>
          <label class="check"><input v-model="draft.showLegend" type="checkbox" />{{ t('note.chart.showLegend') }}</label>
          <label v-if="['line','area','combo'].includes(draft.kind)" class="check"><input v-model="draft.smooth" type="checkbox" />{{ t('note.chart.smooth') }}</label>
        </aside>
        <section class="chart-live-preview"><h3>{{ t('note.chart.preview') }}</h3><div v-if="draft.title" class="note-chart-title">{{ draft.title }}</div><NoteChartCanvas :config="previewConfig" /></section>
        <section class="chart-data-section">
          <div class="chart-data-heading"><h3>{{ t('note.chart.data') }}</h3><div><FridayButton compact :variant="advanced ? 'secondary' : 'text'" @click="toggleAdvanced">{{ t(advanced ? 'note.chart.dataGrid' : 'note.chart.advancedData') }}</FridayButton><FridayButton v-if="!advanced" compact @click="addRow"><Plus :size="14" />{{ t('note.chart.addRow') }}</FridayButton></div></div>
          <p class="chart-data-help">{{ t(`note.chart.help.${helpKind}`) }}</p>
          <textarea v-if="advanced" v-model="dataDraft" class="chart-json" rows="8" spellcheck="false" aria-label="JSON" />
          <div v-else class="chart-data-scroll">
            <table class="chart-data-table"><thead><tr><th>{{ t('note.chart.label') }}</th><th v-if="showSeries">{{ t('note.chart.series') }}</th><th v-if="draft.kind === 'scatter'">X</th><th>{{ t('note.chart.value') }}</th><th v-if="draft.kind === 'errorBar'">{{ t('note.chart.error') }}</th><th v-if="showSamples">{{ t('note.chart.samples') }}</th><th v-if="draft.kind === 'waterfall'">{{ t('note.chart.total') }}</th><th></th></tr></thead>
              <tbody><tr v-for="(row, index) in draftRows" :key="index"><td><input v-model="row.label" :aria-label="t('note.chart.label')" /></td><td v-if="showSeries"><input v-model="row.series" :aria-label="t('note.chart.series')" /></td><td v-if="draft.kind === 'scatter'"><input v-model="row.x" type="number" step="any" aria-label="X" :placeholder="String(index+1)" /></td><td><input v-model="row.value" type="number" step="any" :aria-label="t('note.chart.value')" /></td><td v-if="draft.kind === 'errorBar'"><input v-model="row.error" type="number" min="0" step="any" :aria-label="t('note.chart.error')" /></td><td v-if="showSamples"><input v-model="row.samples" :aria-label="t('note.chart.samples')" :placeholder="t('note.chart.samplesHint')" /></td><td v-if="draft.kind === 'waterfall'"><input v-model="row.isTotal" type="checkbox" :aria-label="t('note.chart.total')" /></td><td><FridayButton icon-only variant="danger" :disabled="draftRows.length <= 1" :aria-label="t('note.chart.removeRow')" @click="draftRows.splice(index,1)"><X :size="15" /></FridayButton></td></tr></tbody>
            </table>
          </div>
          <p v-if="dataError" class="chart-data-error" role="alert">{{ dataError }}</p>
        </section>
      </div>
      <template #footer><FridayButton @click="editing = false">{{ t('note.chart.cancel') }}</FridayButton><FridayButton variant="primary" data-chart-apply @click="applyDraft">{{ t('note.chart.apply') }}</FridayButton></template>
    </FridayDialog>
  </NodeViewWrapper>
</template>

<script setup>
import { computed, onBeforeUnmount, ref } from 'vue'
import { NodeViewWrapper } from '@tiptap/vue-3'
import { useI18n } from 'vue-i18n'
import { Maximize2, Pencil, Plus, X } from 'lucide-vue-next'
import FridayDialog from '@/components/ui/FridayDialog.vue'
import FridayButton from '@/components/ui/FridayButton.vue'
import NoteChartCanvas from './NoteChartCanvas.vue'
import { chartKinds, normalizeChartRows, validateChart } from './chart-model.js'

const props = defineProps({ node: Object, updateAttributes: Function, selected: Boolean, editor: Object })
const { t } = useI18n()
const editing = ref(false), advanced = ref(false), dataDraft = ref(''), dataError = ref(''), draftRows = ref([]), draft = ref({})
const editable = computed(() => props.editor?.isEditable !== false)
const config = computed(() => ({ align: 'left', bins: 0, showLegend: true, smooth: false, ...props.node.attrs }))
const tableLike = computed(() => ['table','stemLeaf'].includes(config.value.kind))
const hasAxes = computed(() => !['pie','funnel','radar','table','stemLeaf'].includes(draft.value.kind))
const showSamples = computed(() => ['box','violin','histogram'].includes(draft.value.kind))
const showSeries = computed(() => !['pie','funnel','waterfall','histogram','stemLeaf'].includes(draft.value.kind))
const helpKind = computed(() => ['scatter','histogram','box','violin','waterfall','errorBar','combo','stemLeaf'].includes(draft.value.kind) ? draft.value.kind : 'general')
const toEditableRows = rows => rows.map(row => ({ ...row, samples: row.samples?.join(', ') || '' }))
const rawData = computed(() => advanced.value ? dataDraft.value : JSON.stringify(draftRows.value))
const previewConfig = computed(() => ({ ...draft.value, data: rawData.value, height: 290 }))
const wrapperStyle = computed(() => ({ width: config.value.responsive ? '100%' : `${config.value.width}px`, maxWidth: '100%', marginLeft: config.value.align === 'left' ? '0' : 'auto', marginRight: config.value.align === 'right' ? '0' : 'auto' }))

function openEditor() {
  if (!editable.value) return
  draft.value = { ...config.value }
  advanced.value = false
  dataError.value = ''
  try { draftRows.value = toEditableRows(normalizeChartRows(config.value.data)) }
  catch { advanced.value = true; dataDraft.value = String(config.value.data || '[]') }
  editing.value = true
}
function selectNode() {
  if (!editable.value || !props.editor || typeof props.getPos !== 'function') return
  try { props.editor.commands.setNodeSelection(props.getPos()) } catch { /* ProseMirror may already be destroying the node view */ }
}
function toggleAdvanced() {
  if (!advanced.value) { dataDraft.value = JSON.stringify(draftRows.value.map(row => ({ ...row, samples: row.samples || undefined })), null, 2); advanced.value = true }
  else {
    try { draftRows.value = toEditableRows(normalizeChartRows(dataDraft.value)); advanced.value = false; dataError.value = '' }
    catch { dataError.value = t('note.chart.invalidData') }
  }
}
function addRow() { draftRows.value.push({ label: String(draftRows.value.length + 1), series: '', value: 0, error: 0, samples: '' }) }
function applyDraft() {
  try {
    const rows = normalizeChartRows(rawData.value)
    validateChart(draft.value, rows)
    props.updateAttributes({ ...draft.value, width: Math.max(240, Math.min(1600, Number(draft.value.width) || 620)), height: Math.max(160, Math.min(1000, Number(draft.value.height) || 320)), bins: Math.max(0, Math.min(100, Number(draft.value.bins) || 0)), data: JSON.stringify(rows) })
    editing.value = false
  } catch (error) {
    const key = `note.chart.${error.message}`
    dataError.value = ['invalidData','invalidSamples','invalidError','nonnegativeData','positiveData','radarData','integerData','duplicateCategory'].includes(error.message) ? t(key) : t('note.chart.invalidData')
  }
}
let resizeCleanup
function beginResize(event) {
  resizeCleanup?.()
  const wrapper = event.currentTarget.closest('.note-chart-node')
  const startWidth = wrapper.getBoundingClientRect().width
  const startHeight = Number(config.value.height) || 320
  const onMove = e => {
    const width = Math.max(240, Math.min(1600, startWidth + e.clientX - event.clientX))
    const height = Math.max(160, Math.min(1000, e.shiftKey ? startHeight + e.clientY - event.clientY : width * startHeight / startWidth))
    props.updateAttributes({ width: Math.round(width), height: Math.round(height), responsive: false })
  }
  const onUp = () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); window.removeEventListener('pointercancel', onUp); resizeCleanup = null }
  window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', onUp, { once: true }); window.addEventListener('pointercancel', onUp, { once: true })
  resizeCleanup = onUp
}
onBeforeUnmount(() => resizeCleanup?.())
</script>

<style scoped>
.note-chart-node{position:relative;margin:16px 0;padding:12px;border:1px solid transparent;border-radius:8px;background:var(--bg-primary);box-sizing:border-box}.note-chart-node.selected{border-color:var(--border-color);user-select:none}.note-chart-title{padding:0 28px;margin:2px 0 8px;font-size:14px;font-weight:600;text-align:center}.chart-node-actions{position:absolute;right:6px;top:6px;display:flex;gap:2px;opacity:0}.note-chart-node:hover .chart-node-actions,.note-chart-node.selected .chart-node-actions,.chart-node-actions:focus-within{opacity:1}.chart-node-actions button{display:grid;place-items:center;width:28px;height:28px;border:0;border-radius:6px;background:var(--bg-secondary);color:var(--text-secondary);cursor:pointer}.chart-node-actions button:hover{background:var(--bg-active)}.chart-resize-handle{position:absolute;bottom:2px;right:2px;width:16px;height:16px;border-bottom:2px solid var(--border-color);border-right:2px solid var(--border-color);cursor:nwse-resize;touch-action:none;opacity:.35}.chart-resize-handle.active,.note-chart-node:hover .chart-resize-handle{opacity:.9}.chart-editor-layout{display:grid;grid-template-columns:230px minmax(0,1fr);gap:20px}.chart-settings{display:flex;flex-direction:column;gap:10px;border-right:1px solid var(--border-color);padding-right:18px}.chart-settings label{display:flex;flex-direction:column;gap:5px;font-size:12px;color:var(--text-secondary)}.chart-settings input,.chart-settings select,.chart-data-table input,.chart-json{min-width:0;box-sizing:border-box;padding:7px 9px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-primary);color:var(--text-primary);font:inherit;font-size:12px;outline:none}.chart-settings input:focus,.chart-settings select:focus,.chart-data-table input:focus,.chart-json:focus{border-color:var(--text-tertiary)}.chart-settings input[type=color]{width:100%;height:30px;padding:3px}.chart-size-fields{display:grid;grid-template-columns:1fr 1fr;gap:8px}.chart-size-fields input{width:100%}.chart-settings .check{flex-direction:row;align-items:center;gap:7px}.chart-settings input[type=checkbox]{accent-color:var(--text-primary)}.chart-live-preview{min-width:0;align-self:center}.chart-live-preview h3,.chart-data-heading h3{margin:0 0 10px;font-size:13px;font-weight:600}.chart-data-section{grid-column:1/-1;min-width:0;border-top:1px solid var(--border-color);padding-top:16px}.chart-data-heading{display:flex;justify-content:space-between;align-items:center}.chart-data-heading>div{display:flex;gap:8px}.chart-data-help{margin:4px 0 12px;color:var(--text-tertiary);font-size:12px;line-height:1.6}.chart-data-scroll{max-height:240px;overflow:auto}.chart-data-table{width:100%;border-collapse:collapse;font-size:12px}.chart-data-table th{text-align:left;font-weight:500;color:var(--text-secondary);padding:4px 5px 7px;white-space:nowrap}.chart-data-table td{padding:3px 5px}.chart-data-table td:last-child{width:28px}.chart-data-table input{width:100%;min-width:70px}.chart-data-table input[type=checkbox]{min-width:0;width:18px}.chart-json{width:100%;resize:vertical;font-family:ui-monospace,Consolas,monospace;line-height:1.5}.chart-data-error{color:var(--danger-color,#c05252);font-size:12px;margin:8px 0 0}@media(max-width:740px){.chart-editor-layout{grid-template-columns:1fr}.chart-settings{border-right:0;padding-right:0;display:grid;grid-template-columns:1fr 1fr}.chart-live-preview{grid-column:1/-1}}
</style>
