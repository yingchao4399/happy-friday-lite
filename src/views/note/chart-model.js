// 笔记图表的数据与统计模型；与渲染库分离，避免图表代码进入普通笔记首屏。
export const chartKinds = ['bar', 'column', 'line', 'area', 'pie', 'scatter', 'histogram', 'waterfall', 'funnel', 'radar', 'combo', 'groupedColumn', 'box', 'violin', 'errorBar', 'stemLeaf', 'table']
export const defaultChartRows = [{ label: 'A', value: 42 }, { label: 'B', value: 68 }, { label: 'C', value: 51 }, { label: 'D', value: 84 }]

const finite = value => ['string', 'number'].includes(typeof value) && String(value).trim() !== '' && Number.isFinite(Number(value))
export function normalizeChartRows(input) {
  const data = typeof input === 'string' ? JSON.parse(input) : input
  if (!Array.isArray(data) || !data.length || data.length > 2000) throw new Error('invalidData')
  let sampleCount = 0
  return data.map((raw, index) => {
    const item = typeof raw === 'number' ? { value: raw } : raw
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('invalidData')
    let samples
    if (item.samples != null && item.samples !== '') {
      samples = Array.isArray(item.samples) ? item.samples : String(item.samples).trim().split(/[,，;；\s]+/)
      if (!samples.length || samples.length > 10000 || !samples.every(finite)) throw new Error('invalidSamples')
      samples = samples.map(Number)
      sampleCount += samples.length
      if (sampleCount > 50000) throw new Error('invalidSamples')
    }
    const value = item.value ?? item.y ?? samples?.[0]
    if (!finite(value)) throw new Error('invalidData')
    if (item.x != null && item.x !== '' && !finite(item.x)) throw new Error('invalidData')
    const error = item.error ?? item.yError ?? 0
    if (!finite(error) || Number(error) < 0) throw new Error('invalidError')
    return {
      ...item,
      label: String(item.label ?? item.name ?? index + 1),
      value: Number(value),
      series: String(item.series ?? ''),
      x: item.x != null && item.x !== '' ? Number(item.x) : undefined,
      error: Number(error),
      samples,
      ...(item.isTotal != null ? { isTotal: item.isTotal === true } : {})
    }
  })
}

export function quantile(values, p) {
  const sorted = [...values].sort((a, b) => a - b)
  if (!sorted.length) throw new Error('invalidSamples')
  const position = (sorted.length - 1) * p
  const lower = Math.floor(position)
  return sorted[lower] + (sorted[Math.ceil(position)] - sorted[lower]) * (position - lower)
}

export function sampleGroups(rows, defaultName = 'Data') {
  const groups = new Map()
  for (const row of rows) {
    const name = row.series || (row.samples ? row.label : defaultName)
    if (!groups.has(name)) groups.set(name, [])
    groups.get(name).push(...(row.samples || [row.value]))
  }
  return [...groups].map(([name, values]) => ({ name, values }))
}

export function boxSummary(values) {
  const sorted = [...values].sort((a, b) => a - b)
  const q1 = quantile(sorted, .25), median = quantile(sorted, .5), q3 = quantile(sorted, .75)
  const iqr = q3 - q1
  const inside = sorted.filter(v => v >= q1 - 1.5 * iqr && v <= q3 + 1.5 * iqr)
  return { min: inside[0], q1, median, q3, max: inside.at(-1), outliers: sorted.filter(v => v < q1 - 1.5 * iqr || v > q3 + 1.5 * iqr) }
}

export function histogram(values, requestedBins = 0) {
  const low = Math.min(...values), high = Math.max(...values), range = high - low
  const iqr = quantile(values, .75) - quantile(values, .25)
  const binWidth = 2 * iqr / Math.cbrt(values.length)
  const auto = binWidth > 0 ? Math.ceil(range / binWidth) : Math.ceil(Math.log2(values.length) + 1)
  const count = Math.max(1, Math.min(100, Math.round(Number(requestedBins) || auto)))
  const width = range ? range / count : 1
  const start = range ? low : low - .5
  const bins = Array.from({ length: range ? count : 1 }, (_, index) => ({ low: start + index * width, high: start + (index + 1) * width, count: 0 }))
  values.forEach(value => { bins[Math.max(0, Math.min(bins.length - 1, Math.floor((value - start) / width)))].count++ })
  return bins
}

export function densityEstimate(values) {
  const n = values.length, mean = values.reduce((a, b) => a + b, 0) / n
  const sd = Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / Math.max(1, n - 1))
  const iqr = quantile(values, .75) - quantile(values, .25)
  const spread = Math.min(sd || Infinity, iqr / 1.34 || Infinity)
  const bandwidth = Number.isFinite(spread) ? .9 * spread * n ** (-.2) : Math.max(1, Math.abs(mean) * .05)
  const low = Math.min(...values) - 3 * bandwidth, high = Math.max(...values) + 3 * bandwidth
  const points = Array.from({ length: 65 }, (_, index) => {
    const value = low + index * (high - low) / 64
    const density = values.reduce((sum, sample) => sum + Math.exp(-.5 * ((value - sample) / bandwidth) ** 2), 0) / (n * bandwidth * Math.sqrt(2 * Math.PI))
    return [value, density]
  })
  return { bandwidth, points }
}

export function waterfallSteps(rows) {
  let cumulative = 0
  return rows.map(row => {
    const from = row.isTotal ? 0 : cumulative
    const to = row.isTotal ? row.value : cumulative + row.value
    cumulative = to
    return { ...row, from, to }
  })
}

export function validateChart(config, rows) {
  if (!chartKinds.includes(config.kind)) throw new Error('invalidType')
  if (['pie', 'funnel', 'radar'].includes(config.kind) && rows.some(row => row.value < 0)) throw new Error('nonnegativeData')
  if (['pie', 'funnel'].includes(config.kind) && !rows.some(row => row.value > 0)) throw new Error('positiveData')
  if (config.kind === 'radar' && new Set(rows.map(row => row.label)).size < 3) throw new Error('radarData')
  if (config.kind === 'stemLeaf' && rows.some(row => !Number.isInteger(row.value))) throw new Error('integerData')
  const categories = new Set()
  if (!['scatter', 'histogram', 'box', 'violin', 'stemLeaf', 'table', 'errorBar'].includes(config.kind)) {
    for (const row of rows) {
      const key = JSON.stringify([row.series, row.label])
      if (categories.has(key)) throw new Error('duplicateCategory')
      categories.add(key)
    }
  }
}

export function stemLeafRows(rows) {
  const groups = new Map()
  rows.map(row => row.value).sort((a, b) => a - b).forEach(value => {
    const stem = `${value < 0 ? '−' : ''}${Math.floor(Math.abs(value) / 10)}`
    if (!groups.has(stem)) groups.set(stem, [])
    groups.get(stem).push(Math.abs(value) % 10)
  })
  return [...groups].map(([label, leaves]) => ({ label, value: leaves.join(' · ') }))
}

export function buildChartOption(config, rows, theme = {}, labels = {}) {
  validateChart(config, rows)
  const colors = [config.color || '#3974a6', '#62a87c', '#d9a441', '#bd6870', '#8a78b7', '#56a7af']
  const ink = theme.text || '#666', border = theme.border || '#ddd'
  const names = [...new Set(rows.map(row => row.series || labels.series || 'Data'))]
  const categories = [...new Set(rows.map(row => row.label))]
  const label = { show: config.showLabels !== false, color: ink }
  const option = {
    animation: false, color: colors, backgroundColor: 'transparent', textStyle: { color: ink },
    tooltip: { trigger: 'item', renderMode: 'richText', confine: true },
    legend: { show: names.length > 1, top: 0, textStyle: { color: ink } },
    grid: { left: 20, right: 24, top: names.length > 1 ? 42 : 24, bottom: 20, outerBoundsMode: 'same', outerBoundsContain: 'all' },
    xAxis: { type: 'category', data: categories, axisLabel: { color: ink }, axisLine: { lineStyle: { color: border } } },
    yAxis: { type: 'value', axisLabel: { color: ink }, splitLine: { show: config.showGrid !== false, lineStyle: { color: border } } },
    series: []
  }
  const bySeries = (name, index) => {
    const items = rows.filter(row => (row.series || labels.series || 'Data') === name)
    return { name, type: 'bar', data: categories.map(category => items.find(row => row.label === category)?.value ?? null), label, itemStyle: { color: colors[index % colors.length] }, emphasis: { focus: 'series' } }
  }
  switch (config.kind) {
    case 'bar':
      option.xAxis = { ...option.yAxis }
      option.yAxis = { type: 'category', data: categories, axisLabel: { color: ink }, inverse: true }
      option.series = names.map(bySeries)
      break
    case 'column': case 'groupedColumn':
      option.series = names.map(bySeries)
      break
    case 'line': case 'area': case 'combo':
      option.series = names.map((name, index) => ({ ...bySeries(name, index), type: config.kind === 'combo' && index === 0 ? 'bar' : 'line', ...(config.kind === 'area' ? { areaStyle: { opacity: .2 } } : {}), connectNulls: false }))
      if (config.kind === 'combo' && names.length === 1) option.series.push({ ...bySeries(names[0], 1), name: labels.trend || 'Trend', type: 'line', label: { show: false } })
      break
    case 'scatter':
      option.xAxis = { ...option.yAxis, scale: true }
      option.series = names.map((name, index) => ({ name, type: 'scatter', symbolSize: 9, data: rows.map((row, i) => ({ row, i })).filter(({ row }) => (row.series || labels.series || 'Data') === name).map(({ row, i }) => ({ name: row.label, value: [row.x ?? i + 1, row.value] })), label: { ...label, formatter: '{b}', position: 'top' }, itemStyle: { color: colors[index % colors.length] } }))
      break
    case 'pie': case 'funnel':
      delete option.xAxis; delete option.yAxis; delete option.grid
      option.legend.show = true
      delete option.legend.data
      option.series = [{ type: config.kind, ...(config.kind === 'pie' ? { radius: '66%', center: ['50%', '55%'] } : { top: 45, bottom: 12, left: '15%', width: '70%', sort: 'none', gap: 2 }), label: { ...label, formatter: '{b}: {c}' }, data: rows.map(row => ({ name: row.label, value: row.value })) }]
      break
    case 'radar':
      delete option.xAxis; delete option.yAxis; delete option.grid
      option.radar = { indicator: categories.map(category => ({ name: category, max: Math.max(1, ...rows.filter(row => row.label === category).map(row => row.value)) * 1.1 })), axisName: { color: ink }, splitLine: { show: config.showGrid !== false, lineStyle: { color: border } }, splitArea: { show: false } }
      option.series = [{ type: 'radar', label, data: names.map((name, index) => ({ name, value: bySeries(name, index).data.map(v => v ?? 0), areaStyle: { opacity: .15 } })) }]
      break
    case 'histogram': {
      const bins = histogram(rows.flatMap(row => row.samples || [row.value]), config.bins)
      option.xAxis.data = bins.map(bin => `${Number(bin.low.toPrecision(5))}–${Number(bin.high.toPrecision(5))}`)
      option.series = [{ type: 'bar', barCategoryGap: '0%', label, data: bins.map(bin => bin.count) }]
      break
    }
    case 'box': {
      const groups = sampleGroups(rows, labels.series)
      const stats = groups.map(group => boxSummary(group.values))
      option.xAxis.data = groups.map(group => group.name)
      option.yAxis.scale = true
      option.series = [{ type: 'boxplot', data: stats.map(s => [s.min, s.q1, s.median, s.q3, s.max]) }, { type: 'scatter', name: labels.outliers || 'Outliers', data: stats.flatMap((s, index) => s.outliers.map(value => [index, value])) }]
      break
    }
    case 'violin': {
      const groups = sampleGroups(rows, labels.series)
      const estimates = groups.map(group => densityEstimate(group.values))
      const allValues = estimates.flatMap(estimate => estimate.points.map(point => point[0]))
      option.xAxis.data = groups.map(group => group.name)
      option.yAxis.min = Math.min(...allValues); option.yAxis.max = Math.max(...allValues)
      option.series = [{ type: 'custom', data: groups.map((_, index) => index), renderItem: (_params, api) => {
        const index = api.value(0), estimate = estimates[index]
        const peak = Math.max(...estimate.points.map(point => point[1]))
        const halfWidth = Math.abs(api.size([1, 0])[0]) * .38
        const points = estimate.points.map(([value, density]) => { const p = api.coord([index, value]); return [p[0] - halfWidth * density / peak, p[1]] })
        const other = [...estimate.points].reverse().map(([value, density]) => { const p = api.coord([index, value]); return [p[0] + halfWidth * density / peak, p[1]] })
        return { type: 'polygon', shape: { points: [...points, ...other] }, style: { fill: colors[index % colors.length], opacity: .6, stroke: colors[index % colors.length] } }
      } }]
      break
    }
    case 'waterfall': {
      const steps = waterfallSteps(rows)
      const values = steps.flatMap(row => [row.from, row.to])
      option.yAxis.min = Math.min(0, ...values); option.yAxis.max = Math.max(1, ...values)
      option.series = [{ type: 'custom', data: steps.map((row, index) => [index, row.from, row.to]), encode: { x: 0, y: [1, 2] }, renderItem: (_params, api) => {
        const index = api.value(0), start = api.coord([index, api.value(1)]), end = api.coord([index, api.value(2)])
        const width = Math.abs(api.size([1, 0])[0]) * .6
        const color = steps[index].isTotal ? colors[0] : api.value(2) >= api.value(1) ? colors[1] : colors[3]
        return { type: 'group', children: [{ type: 'rect', shape: { x: start[0] - width / 2, y: Math.min(start[1], end[1]), width, height: Math.max(1, Math.abs(start[1] - end[1])) }, style: { fill: color } }, ...(label.show ? [{ type: 'text', style: { x: start[0], y: Math.min(start[1], end[1]) - 8, text: String(steps[index].value), fill: ink, align: 'center', verticalAlign: 'bottom' } }] : [])] }
      } }]
      break
    }
    case 'errorBar':
      option.yAxis.min = value => Math.min(value.min, ...rows.map(row => row.value - row.error))
      option.yAxis.max = value => Math.max(value.max, ...rows.map(row => row.value + row.error))
      option.xAxis.data = rows.map(row => row.label)
      option.series = [{ type: 'custom', data: rows.map((row, index) => [index, row.value - row.error, row.value + row.error]), encode: { x: 0, y: [1, 2] }, renderItem: (_params, api) => {
        const low = api.coord([api.value(0), api.value(1)]), high = api.coord([api.value(0), api.value(2)])
        return { type: 'group', children: [[low[0], low[1], high[0], high[1]], [low[0] - 6, low[1], low[0] + 6, low[1]], [high[0] - 6, high[1], high[0] + 6, high[1]]].map(([x1, y1, x2, y2]) => ({ type: 'line', shape: { x1, y1, x2, y2 }, style: { stroke: colors[0], lineWidth: 1.5 } })) }
      } }, { type: 'scatter', data: rows.map((row, index) => [index, row.value]), symbolSize: 8, label }]
      break
  }
  option.legend.show = config.showLegend !== false && (['pie', 'funnel'].includes(config.kind) || names.length > 1 || config.kind === 'combo')
  if (option.xAxis) option.xAxis.name = config.xTitle || ''
  if (option.yAxis) option.yAxis.name = config.yTitle || ''
  option.series.forEach(series => { if (series.type === 'line') series.smooth = config.smooth === true })
  return option
}
