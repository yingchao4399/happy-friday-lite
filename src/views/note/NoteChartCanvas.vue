<template>
  <div ref="host" class="note-chart-canvas" :data-chart-kind="config.kind" :data-chart-ready="ready" :style="{ height: `${Math.max(160, Number(config.height) || 320)}px` }">
    <p v-if="error" class="chart-message error" role="alert">{{ error }}</p>
    <template v-else-if="tableLike">
      <p v-if="config.title" class="table-title">{{ config.title }}</p>
      <div class="chart-table-scroll">
        <table class="chart-table" :class="{ 'three-line': config.kind === 'table' }">
          <thead><tr><th>{{ t(config.kind === 'stemLeaf' ? 'note.chart.stem' : 'note.chart.label') }}</th><th>{{ t(config.kind === 'stemLeaf' ? 'note.chart.leaf' : 'note.chart.value') }}</th><th v-if="hasSeries">{{ t('note.chart.series') }}</th></tr></thead>
          <tbody><tr v-for="(row, index) in tableRows" :key="index"><td>{{ row.label }}</td><td>{{ row.value }}</td><td v-if="hasSeries">{{ row.series }}</td></tr></tbody>
        </table>
      </div>
      <p v-if="config.kind === 'stemLeaf'" class="chart-message">{{ t('note.chart.stemKey') }}</p>
    </template>
    <p v-else-if="!ready" class="chart-message">{{ t('note.chart.loading') }}</p>
    <div v-show="!tableLike && !error" ref="plot" class="chart-plot" role="img" :aria-label="config.title || t(`note.chart.kinds.${config.kind}`)" />
  </div>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { buildChartOption, normalizeChartRows, stemLeafRows, validateChart } from './chart-model.js'
const props = defineProps({ config: { type: Object, required: true } })
const { t, locale } = useI18n()
const host = ref(null), plot = ref(null), ready = ref(false), error = ref('')
const rows = ref([])
const tableLike = computed(() => ['table', 'stemLeaf'].includes(props.config.kind))
const tableRows = computed(() => props.config.kind === 'stemLeaf' ? stemLeafRows(rows.value) : rows.value)
const hasSeries = computed(() => props.config.kind === 'table' && rows.value.some(row => row.series))
let chart, resizeObserver, intersectionObserver, themeObserver, frame, destroyed = false, inView = false, generation = 0
function schedule() { cancelAnimationFrame(frame); frame = requestAnimationFrame(draw) }
async function draw() {
  const current = ++generation
  try {
    const nextRows = normalizeChartRows(props.config.data)
    validateChart(props.config, nextRows)
    rows.value = nextRows
    error.value = ''
    if (tableLike.value) { chart?.dispose(); chart = null; ready.value = true; return }
    if (!inView || destroyed) return
    await nextTick()
    const { init } = await import('./chart-runtime.js')
    if (destroyed || !inView || current !== generation || !plot.value?.clientWidth) return
    chart ||= init(plot.value, null, { renderer: 'svg' })
    const style = getComputedStyle(host.value)
    const option = buildChartOption(props.config, nextRows, { text: style.getPropertyValue('--text-secondary').trim(), border: style.getPropertyValue('--border-color').trim() }, { series: t('note.chart.defaultSeries'), trend: t('note.chart.trend'), outliers: t('note.chart.outliers') })
    chart.setOption(option, { notMerge: true, lazyUpdate: false })
    chart.resize()
    ready.value = true
  } catch (cause) {
    chart?.dispose(); chart = null; ready.value = false
    const key = `note.chart.${cause.message}`
    error.value = ['invalidData', 'invalidSamples', 'invalidError', 'invalidType', 'nonnegativeData', 'positiveData', 'radarData', 'integerData', 'duplicateCategory'].includes(cause.message) ? t(key) : t('note.chart.renderFailed')
  }
}
watch(() => props.config, schedule, { deep: true })
watch(locale, schedule)
onMounted(() => {
  resizeObserver = new ResizeObserver(schedule)
  resizeObserver.observe(host.value)
  intersectionObserver = new IntersectionObserver(entries => {
    inView = entries[0]?.isIntersecting
    if (inView) schedule()
    else { generation++; chart?.dispose(); chart = null; ready.value = false }
  }, { rootMargin: '200px' })
  intersectionObserver.observe(host.value)
  themeObserver = new MutationObserver(schedule)
  themeObserver.observe(document.documentElement, { attributes: true })
  themeObserver.observe(document.body, { attributes: true })
  schedule()
})
onBeforeUnmount(() => {
  destroyed = true; generation++; cancelAnimationFrame(frame)
  resizeObserver?.disconnect(); intersectionObserver?.disconnect(); themeObserver?.disconnect(); chart?.dispose()
})
</script>

<style scoped>
.note-chart-canvas { position:relative; width:100%; min-width:0; color:var(--text-primary); }
.chart-plot { height:100%; width:100%; }
.chart-message { padding:10px; margin:0; font-size:12px; color:var(--text-tertiary); text-align:center; }
.chart-message.error { color:var(--danger-color,#c05252); }
.table-title { margin:0 0 12px; text-align:center; font-size:14px; font-weight:600; }
.chart-table-scroll { overflow:auto; max-height:calc(100% - 42px); }
.chart-table { width:100%; border-collapse:collapse; font-size:13px; }
.chart-table th,.chart-table td { padding:7px 12px; text-align:left; border-bottom:1px solid var(--border-color); }
.chart-table.three-line { border-top:2px solid var(--text-primary); border-bottom:2px solid var(--text-primary); }
.chart-table.three-line th { border-bottom:1px solid var(--text-primary); }
.chart-table.three-line td { border:0; }
</style>
