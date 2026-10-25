<template>
  <NodeViewWrapper class="note-chart-node" :class="{ selected }" :style="wrapperStyle" @dblclick.stop="editing = true">
    <div class="note-chart-toolbar" v-if="editing">
      <label>{{ t('note.chart.type') }}<select v-model="draft.kind"><option v-for="kind in chartKinds" :key="kind.value" :value="kind.value">{{ t(`note.chart.kinds.${kind.value}`) }}</option></select></label>
      <label>{{ t('note.chart.title') }}<input v-model="draft.title" type="text" /></label>
      <label>{{ t('note.chart.color') }}<input v-model="draft.color" type="color" /></label>
      <label>{{ t('note.chart.width') }}<input v-model.number="draft.width" type="number" min="240" max="1200" /></label>
      <label>{{ t('note.chart.height') }}<input v-model.number="draft.height" type="number" min="160" max="800" /></label>
      <label class="chart-check"><input v-model="draft.responsive" type="checkbox" />{{ t('note.chart.responsive') }}</label>
      <label class="chart-check"><input v-model="draft.showGrid" type="checkbox" />{{ t('note.chart.showGrid') }}</label>
      <label class="chart-check"><input v-model="draft.showLabels" type="checkbox" />{{ t('note.chart.showLabels') }}</label>
      <div class="chart-data-editor">
        <div class="chart-data-editor-head">
          <span>{{ t('note.chart.data') }}</span>
          <button type="button" class="chart-action" @click="addRow">＋ {{ t('note.chart.addRow') }}</button>
        </div>
        <div class="chart-data-grid chart-data-grid-head"><span>{{ t('note.chart.label') }}</span><span>{{ t('note.chart.value') }}</span><span>{{ t('note.chart.error') }}</span><span></span></div>
        <div v-for="(row, index) in draftRows" :key="`draft-${index}`" class="chart-data-grid">
          <input v-model="row.label" type="text" @input="syncJsonFromRows" />
          <input v-model.number="row.value" type="number" step="any" @input="syncJsonFromRows" />
          <input v-model.number="row.error" type="number" min="0" step="any" @input="syncJsonFromRows" />
          <button type="button" class="chart-row-remove" :disabled="draftRows.length <= 1" @click="removeRow(index)">×</button>
        </div>
      </div>
      <label class="chart-data-label chart-advanced-data">{{ t('note.chart.advancedData') }}<textarea v-model="dataDraft" rows="3" spellcheck="false" /></label>
      <p v-if="dataError" class="chart-data-error">{{ dataError }}</p>
      <button type="button" class="chart-action primary" @click="applyDraft">{{ t('note.chart.apply') }}</button>
      <button type="button" class="chart-action" @click="editing = false">{{ t('note.chart.cancel') }}</button>
    </div>
    <div class="note-chart-title" v-if="config.title">{{ config.title }}</div>
    <svg v-if="!isTableLike" class="note-chart-svg" :style="chartSvgStyle" :viewBox="`0 0 600 320`" role="img" :aria-label="config.title || t('note.chart.title')">
      <g v-if="config.showGrid !== false" class="chart-grid"><line x1="54" y1="24" x2="54" y2="274" /><line x1="54" y1="274" x2="576" y2="274" /></g>
      <template v-if="isBarLike">
        <rect v-for="(item, index) in rows" :key="`bar-${index}`" class="chart-bar" :fill="config.color" :x="barX(index)" :y="barY(item.value)" :width="barWidth" :height="barHeight(item.value)" rx="3" />
        <text v-if="config.showLabels !== false" v-for="(item, index) in rows" :key="`bar-label-${index}`" class="chart-label" :x="barX(index) + barWidth / 2" y="294" text-anchor="middle">{{ item.label }}</text>
      </template>
      <template v-else-if="isBox">
        <line class="chart-error" x1="315" :y1="boxStats.minY" x2="315" :y2="boxStats.maxY" />
        <line class="chart-error" x1="285" :y1="boxStats.minY" x2="345" :y2="boxStats.minY" />
        <line class="chart-error" x1="285" :y1="boxStats.maxY" x2="345" :y2="boxStats.maxY" />
        <rect class="chart-box" x="270" :y="boxStats.q3Y" width="90" :height="Math.max(2, boxStats.q1Y - boxStats.q3Y)" :fill="config.color" />
        <line class="chart-median" x1="270" :y1="boxStats.medianY" x2="360" :y2="boxStats.medianY" />
      </template>
      <template v-else-if="isViolin">
        <path class="chart-violin" :fill="config.color" :d="violinPath" />
      </template>
      <template v-else-if="isErrorBar">
        <g v-for="(point, index) in linePoints" :key="`error-${index}`">
          <line class="chart-error" :x1="point.x" :y1="point.errorTop" :x2="point.x" :y2="point.errorBottom" />
          <line class="chart-error" :x1="point.x - 7" :y1="point.errorTop" :x2="point.x + 7" :y2="point.errorTop" />
          <line class="chart-error" :x1="point.x - 7" :y1="point.errorBottom" :x2="point.x + 7" :y2="point.errorBottom" />
          <circle class="chart-point" :cx="point.x" :cy="point.y" r="5" :fill="config.color" />
        </g>
      </template>
      <template v-else-if="isPie">
        <path v-for="(slice, index) in pieSlices" :key="`pie-${index}`" :d="slice.path" :fill="palette[index % palette.length]" class="chart-pie-slice" />
        <text v-if="config.showLabels !== false" v-for="(slice, index) in pieSlices" :key="`pie-label-${index}`" class="chart-label" :x="slice.labelX" :y="slice.labelY" text-anchor="middle">{{ slice.label }}</text>
      </template>
      <template v-else-if="isRadar">
        <polygon class="chart-radar-grid" :points="radarGrid" />
        <polygon class="chart-radar-data" :points="radarData" :fill="config.color" />
        <circle v-for="(point, index) in radarPoints" :key="`radar-${index}`" :cx="point.x" :cy="point.y" r="4" :fill="config.color" />
      </template>
      <template v-else-if="isScatter">
        <circle v-for="(point, index) in linePoints" :key="`scatter-${index}`" class="chart-point" :cx="point.x" :cy="point.y" r="5" :fill="config.color" />
      </template>
      <template v-else>
        <polygon v-if="isArea" class="chart-area" :points="`${linePointString} 576,274 54,274`" :fill="config.color" />
        <polyline class="chart-line" :points="linePointString" :stroke="config.color" />
        <circle v-for="(point, index) in linePoints" :key="`line-${index}`" class="chart-point" :cx="point.x" :cy="point.y" r="4" :fill="config.color" />
        <text v-if="config.showLabels !== false" v-for="(item, index) in rows" :key="`line-label-${index}`" class="chart-label" :x="linePoints[index]?.x || 0" y="294" text-anchor="middle">{{ item.label }}</text>
      </template>
    </svg>
    <table v-else class="note-chart-table"><thead><tr><th>{{ t('note.chart.label') }}</th><th>{{ t('note.chart.value') }}</th></tr></thead><tbody><tr v-for="(item, index) in tableRows" :key="index"><td>{{ item.label }}</td><td>{{ item.value }}</td></tr></tbody></table>
    <button v-if="!editing" type="button" class="chart-edit-hint" @click.stop="editing = true">{{ t('note.chart.doubleClick') }}</button>
    <span v-if="selected && !editing" class="chart-resize-handle" :title="t('note.chart.resize')" @pointerdown.prevent.stop="beginResize" />
  </NodeViewWrapper>
</template>

<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { NodeViewWrapper } from '@tiptap/vue-3'
import { useI18n } from 'vue-i18n'

const props = defineProps({ node: Object, updateAttributes: Function, selected: Boolean })
const { t } = useI18n()
const chartKinds = ['bar', 'column', 'line', 'area', 'pie', 'scatter', 'histogram', 'waterfall', 'funnel', 'radar', 'combo', 'groupedColumn', 'box', 'violin', 'errorBar', 'stemLeaf', 'table'].map(value => ({ value }))
const palette = ['#2563eb', '#16a34a', '#f59e0b', '#dc2626', '#7c3aed', '#0891b2', '#db2777']
const editing = ref(false)
const dataDraft = ref('')
const dataError = ref('')
const draftRows = ref([])
const config = computed(() => ({ kind: 'bar', title: '', color: '#2563eb', width: 620, height: 320, responsive: true, showGrid: true, showLabels: true, ...props.node.attrs, rows: parseRows(props.node.attrs.data) }))
const draft = ref({ ...config.value })
watch(() => props.node.attrs, () => {
  if (!editing.value) {
    draft.value = { ...config.value }
    draftRows.value = config.value.rows.map(row => ({ ...row }))
    dataDraft.value = JSON.stringify(config.value.rows, null, 2)
    dataError.value = ''
  }
}, { deep: true, immediate: true })

const addRow = () => {
  draftRows.value.push({ label: `系列 ${draftRows.value.length + 1}`, value: 0, error: 0 })
}
const removeRow = (index) => {
  if (draftRows.value.length <= 1) return
  draftRows.value.splice(index, 1)
  syncJsonFromRows()
}
const syncJsonFromRows = () => { dataDraft.value = JSON.stringify(draftRows.value, null, 2) }

function parseRows(value) {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value || '[]') : value
    if (Array.isArray(parsed) && parsed.length) return parsed.map((item, index) => ({ label: String(item.label ?? item.name ?? index + 1), value: Number(item.value ?? item.y ?? 0) || 0, error: Math.max(0, Number(item.error ?? item.yError ?? 0) || 0) }))
  } catch (_error) { /* 使用默认样例 */ }
  return [{ label: 'A', value: 42 }, { label: 'B', value: 68 }, { label: 'C', value: 51 }, { label: 'D', value: 84 }]
}

const rows = computed(() => config.value.rows)
const maxValue = computed(() => Math.max(1, ...rows.value.map(item => item.value)))
const barWidth = computed(() => Math.max(12, 470 / Math.max(rows.value.length, 1) - 8))
const barX = index => 64 + index * (470 / Math.max(rows.value.length, 1))
const barY = value => 274 - barHeight(value)
const barHeight = value => Math.max(2, 238 * Math.max(0, value) / maxValue.value)
const linePoints = computed(() => rows.value.map((item, index) => {
  const y = 274 - (238 * Math.max(0, item.value) / maxValue.value)
  const error = 238 * Math.max(0, item.error || 0) / maxValue.value
  return { x: 54 + (522 * index / Math.max(rows.value.length - 1, 1)), y, errorTop: Math.max(24, y - error), errorBottom: Math.min(274, y + error) }
}))
const linePointString = computed(() => linePoints.value.map(point => `${point.x},${point.y}`).join(' '))
const isBarLike = computed(() => ['bar', 'column', 'histogram', 'waterfall', 'funnel', 'groupedColumn'].includes(config.value.kind))
const isBox = computed(() => config.value.kind === 'box')
const isViolin = computed(() => config.value.kind === 'violin')
const isErrorBar = computed(() => config.value.kind === 'errorBar')
const isTableLike = computed(() => ['table', 'stemLeaf'].includes(config.value.kind))
const chartSvgStyle = computed(() => ({ height: `${Math.max(160, Number(config.value.height) || 320)}px` }))
const tableRows = computed(() => {
  if (config.value.kind !== 'stemLeaf') return rows.value
  const sorted = rows.value.map(item => item.value).sort((a, b) => a - b)
  const groups = new Map()
  sorted.forEach(value => {
    const stem = Math.trunc(value / 10)
    const leaf = Math.abs(Math.trunc(value)) % 10
    if (!groups.has(stem)) groups.set(stem, [])
    groups.get(stem).push(leaf)
  })
  return [...groups.entries()].map(([stem, leaves]) => ({ label: String(stem), value: leaves.join(' · ') }))
})
const isPie = computed(() => config.value.kind === 'pie')
const isRadar = computed(() => config.value.kind === 'radar')
const isScatter = computed(() => config.value.kind === 'scatter')
const isArea = computed(() => ['area', 'combo'].includes(config.value.kind))
const pieSlices = computed(() => {
  const total = rows.value.reduce((sum, item) => sum + Math.max(0, item.value), 0) || 1
  let angle = -Math.PI / 2
  return rows.value.map((item, index) => {
    const next = angle + (Math.max(0, item.value) / total) * Math.PI * 2
    const large = next - angle > Math.PI ? 1 : 0
    const x1 = 315 + 105 * Math.cos(angle); const y1 = 150 + 105 * Math.sin(angle)
    const x2 = 315 + 105 * Math.cos(next); const y2 = 150 + 105 * Math.sin(next)
    const mid = (angle + next) / 2
    const slice = { path: `M315,150 L${x1},${y1} A105,105 0 ${large} 1 ${x2},${y2} Z`, label: item.label, labelX: 315 + 128 * Math.cos(mid), labelY: 150 + 128 * Math.sin(mid) }
    angle = next
    return slice
  })
})
const radarPoints = computed(() => rows.value.map((item, index) => { const angle = -Math.PI / 2 + index * Math.PI * 2 / Math.max(rows.value.length, 1); const radius = 105 * item.value / maxValue.value; return { x: 315 + radius * Math.cos(angle), y: 150 + radius * Math.sin(angle) } }))
const radarData = computed(() => radarPoints.value.map(point => `${point.x},${point.y}`).join(' '))
const radarGrid = computed(() => rows.value.map((_item, index) => { const angle = -Math.PI / 2 + index * Math.PI * 2 / Math.max(rows.value.length, 1); return `${315 + 105 * Math.cos(angle)},${150 + 105 * Math.sin(angle)}` }).join(' '))
const boxStats = computed(() => {
  const values = rows.value.map(item => item.value).sort((a, b) => a - b)
  const percentile = (p) => values.length ? values[Math.min(values.length - 1, Math.floor((values.length - 1) * p))] : 0
  const min = values[0] || 0; const max = values.at(-1) || 0
  const q1 = percentile(.25); const median = percentile(.5); const q3 = percentile(.75)
  const scale = value => 274 - (238 * Math.max(0, value) / Math.max(1, max))
  return { minY: scale(min), maxY: scale(max), q1Y: scale(q1), medianY: scale(median), q3Y: scale(q3) }
})
const violinPath = computed(() => {
  const values = rows.value.map(item => Math.max(0, item.value))
  const max = Math.max(1, ...values)
  const points = values.map((value, index) => ({ y: 274 - 238 * value / max, width: 18 + 52 * (index + 1) / Math.max(values.length, 1) }))
  const left = points.map(point => `${315 - point.width},${point.y}`).join(' L')
  const right = points.slice().reverse().map(point => `${315 + point.width},${point.y}`).join(' L')
  return `M${left} L${right} Z`
})
const wrapperStyle = computed(() => ({ width: config.value.responsive ? '100%' : `${config.value.width}px`, maxWidth: `${config.value.width}px` }))

let resizeCleanup = null
const beginResize = (event) => {
  resizeCleanup?.()
  const startX = event.clientX
  const startY = event.clientY
  const startWidth = Number(config.value.width) || 620
  const startHeight = Number(config.value.height) || 320
  const ratio = startHeight / Math.max(1, startWidth)
  const onMove = (moveEvent) => {
    const width = Math.max(240, Math.min(1200, startWidth + moveEvent.clientX - startX))
    const height = moveEvent.shiftKey ? Math.max(160, Math.min(800, startHeight + moveEvent.clientY - startY)) : Math.max(160, Math.min(800, width * ratio))
    props.updateAttributes?.({ width: Math.round(width), height: Math.round(height), responsive: false })
  }
  const onUp = () => {
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    resizeCleanup = null
  }
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp, { once: true })
  resizeCleanup = onUp
}

onBeforeUnmount(() => resizeCleanup?.())

const applyDraft = () => {
  let rowsValue
  try {
    const parsed = dataDraft.value.trim() ? JSON.parse(dataDraft.value || '[]') : draftRows.value
    if (!Array.isArray(parsed) || !parsed.length) throw new Error('empty')
    rowsValue = parsed.map((item, index) => ({ label: String(item.label ?? item.name ?? index + 1), value: Number(item.value ?? item.y ?? 0) || 0, error: Math.max(0, Number(item.error ?? item.yError ?? 0) || 0) }))
    dataError.value = ''
  } catch (_error) {
    dataError.value = t('note.chart.invalidData')
    return
  }
  props.updateAttributes?.({ kind: draft.value.kind, title: draft.value.title, color: draft.value.color, width: Number(draft.value.width) || 620, height: Number(draft.value.height) || 320, responsive: !!draft.value.responsive, showGrid: draft.value.showGrid !== false, showLabels: draft.value.showLabels !== false, data: JSON.stringify(rowsValue) })
  editing.value = false
}
</script>

<style scoped>
.note-chart-node { position: relative; margin: 14px 0; padding: 10px; border: 1px solid transparent; border-radius: 8px; background: var(--bg-secondary, #f8fafc); }
.note-chart-node.selected { user-select: none; }
.note-chart-node.selected { border-color: var(--accent-light, #bfdbfe); }
.note-chart-title { margin: 4px 0 8px; text-align: center; font-size: 13px; font-weight: 600; }
.note-chart-svg { display: block; width: 100%; min-height: 180px; overflow: visible; }
.chart-grid line { stroke: var(--border-color, #cbd5e1); stroke-width: 1; }
.chart-bar { opacity: .88; } .chart-line { fill: none; stroke-width: 3; stroke-linecap: round; stroke-linejoin: round; } .chart-point { stroke: var(--bg-primary, #fff); stroke-width: 2; }
.chart-area { opacity: .16; } .chart-label { fill: var(--text-tertiary, #64748b); font-size: 11px; }
.chart-pie-slice { stroke: var(--bg-primary, #fff); stroke-width: 2; } .chart-radar-grid { fill: transparent; stroke: var(--border-color, #cbd5e1); stroke-width: 1; } .chart-radar-data { opacity: .28; stroke: var(--accent-color, #2563eb); stroke-width: 2; }
.chart-error { stroke: var(--text-secondary, #475569); stroke-width: 1.5; } .chart-box { fill-opacity: .28; stroke: var(--accent-color, #2563eb); stroke-width: 2; } .chart-median { stroke: var(--text-primary, #1f2937); stroke-width: 2; } .chart-violin { fill-opacity: .28; stroke: var(--accent-color, #2563eb); stroke-width: 2; }
.note-chart-table { width: 100%; border-collapse: collapse; font-size: 12px; } .note-chart-table th, .note-chart-table td { padding: 6px 9px; border: 1px solid var(--border-color, #e2e8f0); text-align: left; }
.chart-edit-hint { position: absolute; right: 8px; top: 8px; border: 0; border-radius: 5px; padding: 4px 7px; color: var(--text-tertiary, #64748b); background: var(--bg-primary, #fff); font-size: 10px; opacity: 0; cursor: pointer; } .note-chart-node:hover .chart-edit-hint { opacity: 1; }
.note-chart-toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 7px; margin: -2px -2px 10px; padding: 8px; border: 1px solid var(--border-color, #e2e8f0); border-radius: 7px; background: var(--bg-primary, #fff); }
.chart-data-editor { flex: 1 1 100%; min-width: 320px; padding: 8px; border: 1px solid var(--border-color, #e2e8f0); border-radius: 6px; background: var(--bg-secondary, #f8fafc); }
.chart-data-editor-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; color: var(--text-secondary, #475569); font-size: 11px; font-weight: 600; }
.chart-data-grid { display: grid; grid-template-columns: minmax(120px, 1.5fr) minmax(70px, .8fr) minmax(70px, .8fr) 26px; gap: 5px; margin-top: 5px; }
.chart-data-grid-head { color: var(--text-tertiary, #64748b); font-size: 10px; }
.chart-data-grid input { min-width: 0; padding: 5px 6px; border: 1px solid var(--border-color, #cbd5e1); border-radius: 4px; background: var(--bg-primary, #fff); color: inherit; font: inherit; font-size: 11px; }
.chart-row-remove { border: 0; border-radius: 4px; color: #b91c1c; background: transparent; cursor: pointer; font-size: 16px; }
.chart-row-remove:disabled { opacity: .35; cursor: default; }
.chart-advanced-data { flex: 1 1 100%; }
.note-chart-toolbar label { display: flex; align-items: center; gap: 4px; color: var(--text-secondary, #475569); font-size: 11px; } .note-chart-toolbar select, .note-chart-toolbar input[type=text], .note-chart-toolbar input[type=number], .note-chart-toolbar textarea { max-width: 100px; padding: 4px 6px; border: 1px solid var(--border-color, #cbd5e1); border-radius: 4px; background: var(--bg-primary, #fff); color: inherit; font: inherit; } .note-chart-toolbar textarea { width: 190px; max-width: min(260px, 40vw); resize: vertical; font-family: ui-monospace, SFMono-Regular, Consolas, monospace; } .note-chart-toolbar input[type=color] { width: 24px; height: 22px; padding: 0; border: 0; } .chart-check { white-space: nowrap; } .chart-data-label { align-items: flex-start !important; } .chart-data-error { flex-basis: 100%; margin: 0; color: #b91c1c; font-size: 11px; } .chart-action { padding: 5px 9px; border: 1px solid var(--border-color, #cbd5e1); border-radius: 5px; color: var(--text-secondary, #475569); background: var(--bg-primary, #fff); font-size: 11px; cursor: pointer; } .chart-action.primary { color: #fff; border-color: var(--accent-color, #2563eb); background: var(--accent-color, #2563eb); }
.chart-resize-handle { position: absolute; right: 2px; bottom: 2px; width: 14px; height: 14px; border-right: 2px solid var(--accent-color, #2563eb); border-bottom: 2px solid var(--accent-color, #2563eb); cursor: nwse-resize; opacity: .8; }
</style>
