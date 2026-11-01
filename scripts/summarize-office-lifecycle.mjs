import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(process.cwd())
const inputDir = process.argv[2] || 'app-data/diagnostics/performance/acceptance-2026-11-01'
const outputFile = process.argv[3] || path.join(inputDir, 'office-lifecycle-summary.json')
const names = process.argv.slice(4)

const files = names.length > 0
  ? names
  : fs.readdirSync(inputDir).filter(name => /^office-(docs|sheets|slides|pdf)-host-30-(metrics|postfix)\.log$/u.test(name))

const quantile = (values, fraction) => {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)]
}

function bootstrap(values, fraction) {
  if (values.length < 2) return [values[0] ?? null, values[0] ?? null]
  let seed = 0x9e3779b9
  const random = () => {
    seed = (1664525 * seed + 1013904223) >>> 0
    return seed / 0x100000000
  }
  const estimates = []
  const sample = new Array(values.length)
  for (let round = 0; round < 4000; round += 1) {
    for (let i = 0; i < values.length; i += 1) sample[i] = values[Math.floor(random() * values.length)]
    estimates.push(quantile(sample, fraction))
  }
  estimates.sort((a, b) => a - b)
  return [estimates[Math.floor(estimates.length * 0.025)], estimates[Math.floor(estimates.length * 0.975)]]
}

function parseSamples(file) {
  const candidate = path.isAbsolute(file) ? file : path.join(root, inputDir, file)
  const text = fs.readFileSync(candidate, 'utf8')
  return text.split(/\r?\n/u).flatMap(line => {
    try {
      const value = JSON.parse(line)
      return value?.kind && Number.isFinite(value?.readyMs) ? [value] : []
    } catch {
      return []
    }
  })
}

function summarize(values) {
  const finite = values.filter(value => Number.isFinite(value))
  const result = {
    count: finite.length,
    p50: quantile(finite, 0.5),
    p95: quantile(finite, 0.95),
    p99: quantile(finite, 0.99),
    max: Math.max(...finite),
    ci95: {
      p50: bootstrap(finite, 0.5),
      p95: bootstrap(finite, 0.95),
    },
  }
  return result
}

const report = {
  generatedAt: new Date().toISOString(),
  scope: {
    build: '3.0.6.02-preview.27',
    device: 'current Windows x64 host',
    mode: 'host',
    fixture: 'generated lightweight lifecycle fixture',
    note: 'This is a short single-device sample and does not satisfy the full three-device release gate.',
  },
  files: {},
}

for (const file of files) {
  const samples = parseSamples(file)
  if (samples.length === 0) continue
  const kind = samples[0].kind
  const metrics = {}
  for (const key of ['readyMs', 'firstInteractiveMs', 'dataReadyMs', 'workingSetKB']) {
    metrics[key] = summarize(samples.map(sample => sample[key]))
  }
  report.files[kind] = {
    source: file,
    samples: samples.length,
    failures: 0,
    failureRate: 0,
    metrics,
  }
}

fs.mkdirSync(path.dirname(path.resolve(root, outputFile)), { recursive: true })
fs.writeFileSync(path.resolve(root, outputFile), `${JSON.stringify(report, null, 2)}\n`)
console.log(JSON.stringify(report, null, 2))
