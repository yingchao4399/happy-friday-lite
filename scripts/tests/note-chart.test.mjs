import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeChartRows, quantile, histogram, boxSummary, densityEstimate, waterfallSteps, buildChartOption, sampleGroups, stemLeafRows, chartKinds } from '../../src/views/note/chart-model.js'
import { init } from '../../src/views/note/chart-runtime.js'

test('图表数据保存真实 X、系列、样本、负值和附加来源，空可选值不会变成 0', () => {
  const input = [{ label: 'p', value: -5, x: -12.5, series: '实验组', samples: [-3, -2, 9], error: .4, source: '来源' }, { value: 1, x: '', samples: '' }]
  const rows = normalizeChartRows(JSON.stringify(input))
  assert.equal(rows[0].x, -12.5); assert.deepEqual(rows[0].samples, [-3, -2, 9]); assert.equal(rows[0].source, '来源')
  assert.equal(rows[1].x, undefined); assert.equal(rows[1].samples, undefined)
  assert.deepEqual(normalizeChartRows(JSON.stringify(rows)), rows)
  for (const bad of [[{ value: 'abc' }], [{ value: true }], [{ value: 4, error: -1 }], [{ value: 4, samples: '3, nope' }], []]) assert.throws(() => normalizeChartRows(bad))
})
test('直方图真正分箱，最大边界计入最后一箱，常量与负值不丢失', () => {
  const bins = histogram([-4, -2, 0, 2, 4], 2)
  assert.deepEqual(bins.map(b => b.count), [2, 3])
  assert.equal(bins[0].low, -4); assert.equal(bins.at(-1).high, 4)
  assert.deepEqual(histogram([7, 7, 7], 10), [{ low: 6.5, high: 7.5, count: 3 }])
})
test('箱线图线性插值四分位、Tukey 须和离群值，包含负样本', () => {
  assert.equal(quantile([0, 10, 20, 30], .25), 7.5)
  assert.deepEqual(boxSummary([-9, -8, -7, -6, 100]), { min: -9, q1: -8, median: -7, q3: -6, max: -6, outliers: [100] })
  assert.deepEqual(sampleGroups(normalizeChartRows([{ label: 'a', samples: [1, 2] }, { label: 'b', samples: [8, 9] }])), [{ name: 'a', values: [1, 2] }, { name: 'b', values: [8, 9] }])
})
test('小提琴图采用可重复 KDE，样本顺序不改变密度，常量仍有有限带宽', () => {
  const one = densityEstimate([-3, -2, -1, 1, 2, 3]), two = densityEstimate([3, 2, 1, -1, -2, -3])
  one.points.forEach((p, i) => { assert.ok(Math.abs(p[1] - two.points[i][1]) < 1e-12) })
  const dx = one.points[1][0] - one.points[0][0]
  const integral = one.points.reduce((sum, p) => sum + p[1] * dx, 0)
  assert.ok(integral > .99 && integral < 1.01)
  assert.ok(densityEstimate([0, 0, 0]).points.every(p => p.every(Number.isFinite)))
})
test('瀑布图累计正负变化并识别合计，散点不替换用户 X 坐标', () => {
  const steps = waterfallSteps([{ value: 10 }, { value: -4 }, { value: 6, isTotal: true }, { value: 3 }])
  assert.deepEqual(steps.map(s => [s.from, s.to]), [[0, 10], [10, 6], [0, 6], [6, 9]])
  const scatter = buildChartOption({ kind: 'scatter' }, normalizeChartRows([{ value: -4, x: -20 }, { value: 9, x: 200 }]))
  assert.deepEqual(scatter.series[0].data.map(p => p.value), [[-20, -4], [200, 9]])
})
test('分组柱与组合图保存各系列，横条轴向正确，配置开关有实际效果', () => {
  const data = normalizeChartRows([{ label: 'Q1', series: 'A', value: 1 }, { label: 'Q1', series: 'B', value: 5 }, { label: 'Q2', series: 'A', value: 3 }])
  const grouped = buildChartOption({ kind: 'groupedColumn' }, data)
  assert.deepEqual(grouped.series.map(s => s.data), [[1, 3], [5, null]])
  const combo = buildChartOption({ kind: 'combo', smooth: true, showLegend: false, xTitle: '季度' }, data)
  assert.deepEqual(combo.series.map(s => s.type), ['bar', 'line']); assert.equal(combo.series[1].smooth, true); assert.equal(combo.legend.show, false); assert.equal(combo.xAxis.name, '季度')
  assert.equal(buildChartOption({ kind: 'bar' }, data).yAxis.type, 'category')
  assert.throws(() => buildChartOption({ kind: 'pie' }, normalizeChartRows([{ value: -1 }])), /nonnegativeData/)
  assert.deepEqual(stemLeafRows(normalizeChartRows([-12, -2, 2, 12])), [{ label: '−1', value: '2' }, { label: '−0', value: '2' }, { label: '0', value: '2' }, { label: '1', value: '2' }])
})
test('所有绘图类型使用真正 ECharts SVG 渲染，无空图或渲染异常', () => {
  for (const kind of chartKinds.filter(kind => !['table', 'stemLeaf'].includes(kind))) {
    const instance = init(null, null, { renderer: 'svg', ssr: true, width: 700, height: 360 })
    try {
      const rows = normalizeChartRows(kind === 'pie' ? [{ label: '唯一', value: 100 }] : [{ label: 'A', value: 42, error: 3 }, { label: 'B', value: 68, error: 5 }, { label: 'C', value: 51, error: 2 }, { label: 'D', value: 84, error: 4 }])
      instance.setOption(buildChartOption({ kind, showLabels: true, color: '#3974a6' }, rows))
      const svg = instance.renderToSVGString()
      assert.match(svg, /<svg/); assert.ok(svg.length > 700, `${kind}: SVG 应有实际图形`)
      assert.doesNotMatch(svg, /NaN|Infinity/)
    } finally { instance.dispose() }
  }
})
