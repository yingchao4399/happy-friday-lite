import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import assert from 'node:assert/strict'
import { Marked } from 'marked'

const root = fileURLToPath(new URL('../../', import.meta.url))
const out = path.join(root, 'docs/office-ai-capability-2026-11-05')
const upstreamObservation = JSON.parse(await fs.readFile(new URL('./upstream-release-observation.json', import.meta.url), 'utf8'))
const documents = [
  { file: '01-research-report', short: '根因研究报告', summary: '复现证据、三条调用链、分层根因、方案取舍及后续上游融合约束。', chapters: 14 },
  { file: '02-product-requirements', short: '产品需求 PRD', summary: '用户流程、能力与权限合同、质量要求、48 项验收与持续升级需求。', chapters: 18 },
  { file: '03-architecture-and-work-breakdown', short: '架构方案与技术拆解', summary: '协议、模块、状态、快照、交付、技术难点、14 个工作包与上游兼容机制。', chapters: 21 },
  { file: '04-upstream-integration-contract', short: '持续上游集成合同', summary: '固定来源、通用 hooks、完整应用对等模板、U0–U5 升级门禁、匹配组合和回滚。', chapters: 13 },
  { file: '05-implementation-and-validation', short: '实施与验收账本', summary: '实际代码与证据、14 个工作包状态、三入口待验收、安装与 GitHub 交付边界。', chapters: 14, version: '0.3' },
]
const esc = v => String(v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const sha = b => createHash('sha256').update(b).digest('hex')
const style = `
:root { color-scheme:light; --ink:#202b3d; --muted:#526078; --line:#dce3ec; --accent:#205e94; --pale:#edf4fa }
* { box-sizing:border-box }
html { scroll-behavior:smooth; scroll-padding-top:24px }
body { margin:0; background:#f3f5f8; color:var(--ink); font-family:"Microsoft YaHei","PingFang SC",system-ui,sans-serif; font-size:16px; line-height:1.85 }
a { color:var(--accent); text-underline-offset:3px }
a:focus-visible,summary:focus-visible,.table-scroll:focus-visible { outline:3px solid #d28b1b; outline-offset:4px }
.top { background:#fff; border-bottom:1px solid var(--line) }
.top-inner { max-width:1400px; margin:auto; padding:17px 30px; display:flex; gap:18px; align-items:center; flex-wrap:wrap }
.brand { font-size:17px; font-weight:700; margin-right:auto }
.top nav { display:flex; gap:18px; flex-wrap:wrap; font-size:14px }
.top nav a[aria-current=page] { color:#172c48; font-weight:700; text-decoration:underline }
.layout { max-width:1400px; margin:28px auto 60px; display:grid; grid-template-columns:260px minmax(0,1fr); gap:24px; padding:0 24px; align-items:start }
.toc { position:sticky; top:20px; max-height:calc(100vh - 40px); overflow:auto; font-size:13px; padding:20px; background:white; border:1px solid var(--line); border-radius:10px }
.toc summary { font-size:15px; font-weight:700; cursor:pointer; margin-bottom:12px }
.toc a { display:block; padding:6px 0; color:#42546f; text-decoration:none; line-height:1.6 }
.toc a:hover { color:var(--accent); text-decoration:underline }
.toc .sub { padding-left:12px; font-size:12px; color:#68758a }
main { min-width:0; background:white; border:1px solid var(--line); border-radius:10px; padding:36px 42px }
.status { border-left:4px solid #bd851f; background:#fff7e7; padding:12px 16px; font-size:14px; margin:0 0 26px }
h1 { font-size:30px; line-height:1.5; margin:0 0 20px; letter-spacing:.2px }
h2 { font-size:23px; margin:44px 0 18px; padding-top:16px; border-top:1px solid var(--line); line-height:1.6; break-after:avoid }
h3 { font-size:18px; margin:28px 0 12px; line-height:1.7; break-after:avoid }
p { margin:12px 0; overflow-wrap:anywhere }
ul,ol { padding-left:1.7em } li { margin:6px 0; overflow-wrap:anywhere }
.table-scroll { width:100%; overflow-x:auto; margin:20px 0; border:1px solid var(--line); border-radius:6px }
table { border-collapse:collapse; width:100%; font-size:14px; line-height:1.75; min-width:560px }
th,td { padding:11px 13px; text-align:left; vertical-align:top; border-bottom:1px solid var(--line); border-right:1px solid var(--line); overflow-wrap:anywhere }
th { background:var(--pale); color:#253c56; font-weight:700 }
th:last-child,td:last-child { border-right:0 } tr:last-child td { border-bottom:0 }
tbody tr:nth-child(even) { background:#fafbfd }
pre { background:#f2f5f9; border:1px solid var(--line); border-radius:6px; padding:17px; overflow:auto; font:13px/1.75 Consolas,"Cascadia Mono","Microsoft YaHei",monospace; tab-size:2 }
pre code { font:inherit; background:none; padding:0; border:0 }
code { font:.88em/1.7 Consolas,"Microsoft YaHei",monospace; padding:2px 4px; background:#f0f4f8; border-radius:3px; overflow-wrap:anywhere }
blockquote { margin:18px 0; border-left:3px solid #9ab5cf; padding:4px 16px; color:var(--muted); background:#f6f9fc }
.bottom { margin-top:38px; border-top:1px solid var(--line); padding-top:20px; color:var(--muted); font-size:13px }
.doc-nav { display:flex; gap:12px 24px; flex-wrap:wrap; margin-top:16px }
.landing { max-width:1120px; margin:32px auto 60px; padding:36px 42px }
.eyebrow { color:var(--accent); font-size:13px; font-weight:700; margin-bottom:12px; letter-spacing:1px }
.cards { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:18px; margin:28px 0 }
.card { border:1px solid var(--line); border-radius:8px; padding:22px; background:#fafcfe }
.card h2 { border:0; padding:0; margin:4px 0 12px; font-size:20px }
.card p { font-size:14px; color:var(--muted) }
.meta { font-size:13px; color:var(--muted) }
.skip { position:absolute; top:-100px; left:20px; background:white; padding:10px; z-index:10 }
.skip:focus { top:10px }
@media(max-width:1000px) {
 .layout { grid-template-columns:210px minmax(0,1fr); gap:16px; padding:0 14px }
 main { padding:26px } .cards { grid-template-columns:1fr }
}
@media(max-width:760px) {
 .layout { display:block; margin-top:16px }
 .toc { position:static; max-height:300px; margin-bottom:18px }
 main,.landing { padding:22px 18px } .landing { margin:16px 12px }
 .top-inner { padding:14px 18px; gap:10px } h1 { font-size:24px } h2 { font-size:21px }
}
@media print {
 body { background:white; font-size:10pt; line-height:1.65 }
 .top,.toc,.skip,.doc-nav { display:none }
 .layout { display:block; padding:0; margin:0 }
 main,.landing { border:0; padding:0; margin:0; max-width:none }
 h1 { font-size:20pt } h2 { font-size:16pt; margin-top:22pt } h3 { font-size:12pt }
 .table-scroll { overflow:visible; border:0 }
 table { min-width:0; font-size:8pt; line-height:1.5 }
 th,td { padding:5pt; border:1px solid #bbb } thead { display:table-header-group }
 pre { white-space:pre-wrap; overflow-wrap:anywhere; font-size:8pt }
 .cards { display:block } .card { break-inside:avoid; margin-bottom:12pt }
 @page { size:A4; margin:16mm }
}`
function nav(current) {
  return '<a href="index.html"' + (current === 'index' ? ' aria-current="page"' : '') + '>文档导航</a>' +
    documents.map(d => '<a href="' + d.file + '.html"' + (current === d.file ? ' aria-current="page"' : '') + '>' + esc(d.short) + '</a>').join('')
}
function frame(title, current, body) {
  return '<!doctype html>\n<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; img-src data:; base-uri \'none\'; form-action \'none\'"><title>' +
    esc(title) + '</title><style>' + style + '</style></head><body><a class="skip" href="#main">跳到正文</a><header class="top"><div class="top-inner"><span class="brand">Friday Office · 研究、合同与实施</span><nav aria-label="文档导航">' +
    nav(current) + '</nav></div></header>' + body + '</body></html>\n'
}
const stats = []
for (const d of documents) {
  const md = await fs.readFile(path.join(out, d.file + '.md'), 'utf8')
  assert(!md.includes('\ufffd'), d.file + ' 有替换字符')
  assert(md.includes(upstreamObservation.releaseTag), d.file + ' 未同步已核验的上游候选版本')
  assert(md.includes(upstreamObservation.tagRefSha), d.file + ' 未同步上游候选 SHA')
  const parsedHeadings = new Marked().lexer(md).filter(token => token.type === 'heading')
  assert.equal(parsedHeadings.filter(token => token.depth === 1).length, 1, '标题不唯一')
  assert.equal(parsedHeadings.filter(token => token.depth === 2).length, d.chapters, '章节不完整')
  const title = parsedHeadings.find(token => token.depth === 1).text
  const headings = []
  let sequence = 0
  const markdown = new Marked()
  markdown.use({ renderer: {
    heading({ tokens, depth }) {
      const text = this.parser.parseInline(tokens)
      const id = 'heading-' + (++sequence)
      if (depth === 2 || depth === 3) headings.push({ depth, text, id })
      return '<h' + depth + ' id="' + id + '">' + text + '</h' + depth + '>\n'
    },
    html({ text }) { return esc(text) },
  } })
  let html = markdown.parse(md)
  html = html.replace(/<table>/g, '<div class="table-scroll" tabindex="0" role="region" aria-label="可横向滚动的表格"><table>').replace(/<\/table>/g, '</table></div>')
  const toc = headings.map(h => '<a class="' + (h.depth === 3 ? 'sub' : '') + '" href="#' + h.id + '">' + h.text + '</a>').join('')
  const count = (md.match(/\p{Script=Han}/gu) || []).length
  const status = '<div class="status"><strong>阅读提示：</strong>第 01–03 篇保存研究与 Proposed 设计，第 04 篇为持续升级合同，第 05 篇记录实施与验收。较早实现快照曾完成 Office 全量构建；后续源码有变化，当前候选是否与生成资源匹配，以第 05 篇最新门禁结果为准。真实 Electron 四路径 fixture、远端模型、Core 完整对话、安装与 GitHub 发布均按各自证据验收。</div>'
  const bottom = '<footer class="bottom">版本 ' + (d.version || '1.0') + ' · ' + d.chapters + ' 个主章节 · 约 ' + count.toLocaleString('zh-CN') + ' 个汉字（不含代码、英文与标点）<br>HTML 为 Markdown 源稿的离线阅读版。源码与接口以文档所列固定 SHA 为准。<div class="doc-nav"><a href="' + d.file + '.md">查看 Markdown 源稿</a><a href="index.html">返回文档导航</a></div></footer>'
  const page = frame(title, d.file, '<div class="layout"><aside class="toc"><details open><summary>本篇目录</summary>' + toc + '</details></aside><main id="main">' + status + html + bottom + '</main></div>')
  await fs.writeFile(path.join(out, d.file + '.html'), page, 'utf8')
  stats.push({ file: d.file, chapters: d.chapters, hanCharacters: count, markdownBytes: Buffer.byteLength(md), htmlBytes: Buffer.byteLength(page), sha256: sha(md) })
}
const cards = documents.map((d,i) => '<section class="card"><div class="eyebrow">文档 0' + (i+1) + '</div><h2><a href="' + d.file + '.html">' + esc(d.short) + '</a></h2><p>' + esc(d.summary) + '</p><p class="meta">' + stats[i].chapters + ' 个主章节 · 约 ' + stats[i].hanCharacters.toLocaleString('zh-CN') + ' 个汉字</p><a href="' + d.file + '.html">打开阅读版 →</a><p><a href="' + d.file + '.md">Markdown 源稿</a></p></section>').join('')
const landing = frame('Friday Office — 根因研究、PRD、技术方案与实施账本', 'index', '<main class="landing" id="main"><div class="eyebrow">2026-11-06 · 独立专项文档与实施记录</div><h1>Friday Office AI 能力与<br>PDF 转 Word 实施与验收</h1><p>以 PDF→Word 为首个完整闭环，统一按钮、Office 内 AI 与主助手的业务执行，并为后续持续融合 GenOffice 新版本保留清楚的宿主与上游边界。</p><div class="status"><strong>交付状态：</strong>preview.35 Office 资源重建与只读校验通过；占位符修复后的 Windows x64 安装器已生成，包内 2497 项 Office 资源、原生模块与启动 smoke 通过。electron-builder 在最后写 `latest.yml` 时返回异常，更新元数据已根据真实安装器校正。安装/升级/回滚、远端模型/Core 完整对话和 GitHub 发布仍待验收；候选未签名。</div><div class="cards">' + cards + '</div><h2>这次方案的核心</h2><ol><li>复用现有 AI Core 与 registry，由 Office 领域执行器共用资源、授权、转换与真实文件交付。</li><li>转换与内容创建分开；DOCX 必须通过保存、回读和内容检查，打开结果单独反馈。</li><li>覆盖未保存源、取消、重复请求、覆盖保护、崩溃恢复、OCR 降级和安装资源。</li><li>GenOffice 保持原生编辑器与算法，Friday 维护薄 adapter、版本合同、差异清单与上游升级门禁。</li></ol><h2>阅读与文件说明</h2><p>五篇均可独立离线阅读，无需联网加载字体、脚本或样式。建议依次阅读研究、PRD、技术拆解、持续升级合同和实施账本。使用目录跳转章节；窄窗口中的长表格可以横向滚动。浏览器打印可另存为 PDF。</p><p>直接在文件管理器中打开本目录的 <code>index.html</code> 即可。请将同目录的六个 HTML 一起保留，以便导航。Markdown 是可编辑源稿，HTML 是相同内容的阅读版本；第 04、05 篇是新增合同与实施记录，前三篇研究范围和原总体文档继续保留。</p><p>原 GenOffice 总体三份文档、旧 PDF 专项三份文档均保留；Markdown/HTML 完整功能对等和后续上游融合需求继续有效。</p><footer class="bottom">源码基线：631f535d53c0812bed29bfcf5c679a4485123e9d<br>Office vendor：8ed0c8d099c3c3d87b1a998d9189da3d120ff820<br>历史固定升级目标 v0.12.600，不代表已核验为今日最新。</footer></main>')
const upstreamNote = '历史固定升级目标 v0.12.600；2026-11-05 核验官方 Latest 为 ' + esc(upstreamObservation.releaseTag) + '，作为后续评估候选，尚未融合验收。'
const oldLandingStatus = 'preview.35 Office 资源重建与只读校验通过；占位符修复后的 Windows x64 安装器已生成，包内 2497 项 Office 资源、原生模块与启动 smoke 通过。electron-builder 在最后写 `latest.yml` 时返回异常，更新元数据已根据真实安装器校正。安装/升级/回滚、远端模型/Core 完整对话和 GitHub 发布仍待验收；候选未签名。'
const landingStatus = 'preview.36 本地候选安装器已生成；包内资源、原生模块、启动检查与 PDF/Core 确定性交付探针通过，PDF AI 真实模型复测和十组合成质量探针通过。真实主窗口与主助手自由规划、复杂真实 PDF、安装/升级/回滚、完整源码提交及 GitHub 发布仍待关闭。AI HTML 已开始基础构建接入，完整对等和 GenOffice 新版融合尚未完成。最新证据及剩余任务见第 05 篇第 2.1、2.2 节。'
assert(landing.includes(oldLandingStatus), '首页历史状态未找到')
await fs.writeFile(path.join(out, 'index.html'), landing.replace(oldLandingStatus, landingStatus).replace('历史固定升级目标 v0.12.600，不代表已核验为今日最新。', upstreamNote), 'utf8')

const prd = await fs.readFile(path.join(out, '02-product-requirements.md'), 'utf8')
const requirementIds = [...prd.matchAll(/^\| ((?:CAP|SRC|DOC|OUT|TASK|QUA|UPD)\d+) \|/gm)].map(x => x[1])
const acceptanceIds = [...prd.matchAll(/^\| (AC\d+) \|/gm)].map(x => x[1])
assert.equal(new Set(requirementIds).size, 65)
assert.equal(new Set(acceptanceIds).size, 48)
const tech = await fs.readFile(path.join(out, '03-architecture-and-work-breakdown.md'), 'utf8')
assert.equal((tech.match(/^\| W\d+ \|/gm) || []).length, 14)
const oldDocs = [
  ['GenOffice-v0.12.600-升级分析报告.md', '8B65B67AB97B740E5236B959FF9393F5A0B348D8172B3A89BAF9CF7482F055BB'],
  ['GenOffice-v0.12.600-融合升级方案.md', 'D17E30433EDA49561BAF48EE0DFA0AEB63E4B765590ABDF76D8C08DE860F11BE'],
  ['GenOffice-v0.12.600-融合升级PRD.md', '4F20C3FF905D14E95A591DAF46E1C064730BEE16576B9F20F4CEB3305544DE11'],
  ['PDF转Word-故障研究报告.md', '1B20413D9160B658529C60618526BB4558B227F5CA8F5B5FE1AA9F907BF33B7B'],
  ['PDF转Word-修复方案.md', 'F358E5DB523F544C552D17ABCA024355F16816712EB6F54DFD184689841E22C7'],
  ['PDF转Word-修复PRD.md', '8F590CC71D6AADCC11071B9EA73073BD2DDEFDE882F40B2CDB550CC12C6AA844'],
]
const preserved = []
for (const [file, expected] of oldDocs) {
  const actual = sha(await fs.readFile(path.join(root, 'docs', file))).toUpperCase()
  assert.equal(actual, expected, '旧文档被修改：' + file)
  preserved.push({ file, sha256: actual, unchanged: true })
}
const htmlChecks = []
for (const file of ['index', ...documents.map(d => d.file)]) {
  const html = await fs.readFile(path.join(out, file + '.html'), 'utf8')
  assert(html.startsWith('<!doctype html>'))
  assert(html.includes('<meta charset="utf-8">'))
  assert(html.endsWith('</body></html>\n'))
  assert(!/<script\b|<link\b|<iframe\b/i.test(html), '不应有外部或执行依赖')
  assert(!html.includes('\ufffd'), '有损编码')
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(x => x[1])
  assert.equal(new Set(ids).size, ids.length, '重复锚点')
  for (const [,href] of html.matchAll(/\bhref="([^"]+)"/g)) {
    if (href.startsWith('#')) assert(ids.includes(href.slice(1)), '锚点缺失 ' + href)
    else {
      assert(!href.includes(':'), '出现外部链接')
      await fs.access(path.join(out, href))
    }
  }
  htmlChecks.push({ file: file + '.html', localLinks: true, utf8: true, selfContained: true, anchorsUnique: true })
}
const report = { checkedAt: new Date().toISOString(), status: 'document-build-and-static-checks-passed', productFixStatus: 'implementation-in-progress', productEvidenceDocument: '05-implementation-and-validation.md', documents: stats, requirements: requirementIds.length, acceptanceCases: acceptanceIds.length, workPackages: 14, originalDocuments: preserved, htmlChecks, upstreamObservation }
await fs.writeFile(new URL('./validation.json', import.meta.url), JSON.stringify(report,null,2) + '\n')
console.log(JSON.stringify(report,null,2))
