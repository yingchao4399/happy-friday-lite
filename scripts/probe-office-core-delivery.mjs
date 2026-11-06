// 确定性 planner + 真实 Core/registry/Office 服务；不调用外部模型。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import AdmZip from 'adm-zip'
import { officeProbeRuntime } from './lib/office-probe-runtime.mjs'

const filename = fileURLToPath(import.meta.url)
const root = fileURLToPath(new URL('../', import.meta.url))
const runtime = officeProbeRuntime(root)
const reportFile = runtime.reportFile || path.join(root, 'artifacts', 'office-core-delivery-report.json')
const hash = bytes => createHash('sha256').update(bytes).digest('hex')

if (!process.versions.electron) {
  const { spawn } = await import('node:child_process')
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  const child = spawn(createRequire(import.meta.url)('electron'), [filename, ...process.argv.slice(2)], { cwd: root, env, windowsHide: true, stdio: 'inherit' })
  const deadline = setTimeout(() => child.kill(), 300000)
  process.exitCode = await new Promise(resolve => {
    child.once('error', error => { console.error(error); resolve(1) })
    child.once('exit', code => resolve(code ?? 1))
  })
  clearTimeout(deadline)
} else {
  const { app, BrowserWindow, ipcMain } = await import('electron')
  runtime.configure(app)
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'friday-office-core-delivery-'))
  const agentRootDir = path.join(directory, 'knowledge', 'agent')
  app.setPath('userData', path.join(directory, 'profile'))
  app.on('window-all-closed', () => {})
  const db = await runtime.load('src-electron/db.js')
  const { setDataDir } = await runtime.load('src-electron/config.js')
  const host = await runtime.load('src-electron/office/office-host.js')
  const { createAiCoreRuntime, hasVerifiedOfficeArtifact } = await runtime.load('src-electron/ai-core/task-runtime.js')
  const { createAiCoreFacade } = await runtime.load('src-electron/ai-core/facade.js')
  const { getAiCoreStore } = await runtime.load('src-electron/ai-core/store.js')
  const { executeCapability, listRegisteredTools } = await runtime.load('src-electron/agent/tools/registry.js')
  await runtime.load('src-electron/agent/tools/builtin/officeOperations.js')
  const report = { ok: false, checkedAt: new Date().toISOString(), mode: 'deterministic-planner-no-remote-model',
    coverage: 'Core 审批、真实 registry schema/scope/audit、真实 Office renderer/worker 和文件回读；不证明远端模型规划或工具选择',
    runtime: runtime.evidence(), isolatedDataDir: directory, steps: [] }
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
  let win
  app.whenReady().then(async () => {
    try {
      setDataDir(directory)
      db.setDataDir(directory)
      await db.initDb()
      ipcMain.handle('project:resolveChat', () => null)
      win = new BrowserWindow({ show: false, width: 1200, height: 900, webPreferences: { sandbox: true } })
      assert.equal(await host.initOfficeHost(win), true)
      host.setOfficeContentBounds({ x: 0, y: 0, width: 1200, height: 860 })
      const capabilities = listRegisteredTools().filter(tool => ['office_document_create', 'office_document_convert'].includes(tool.name)).map(tool => ({
        id: tool.name, type: tool.meta.capabilityType, risk: 'medium', requiredScopes: tool.meta.requiredScopes, version: tool.meta.version
      }))
      assert.equal(capabilities.length, 2)
      const facade = createAiCoreFacade({ capabilities })
      let registryCalls = 0
      const runtime = createAiCoreRuntime({ facade, store: getAiCoreStore(db),
        executionContext: { dataDir: directory, agentRootDir, mainWindow: win, sourceEntry: 'main-assistant' },
        executeCapability: async (...args) => { registryCalls++; return executeCapability(...args) }
      })
      const context = requestId => ({ actor: { id: 'user:local', type: 'user' }, spaceId: 'friday', requestId,
        scopes: ['read', 'write', 'ui'], resourceUris: [] })
      async function terminal(taskId, timeoutMs = 160000) {
        const deadline = Date.now() + timeoutMs
        while (Date.now() < deadline) {
          const task = runtime.get(taskId, 'user:local')
          if (['completed', 'failed', 'cancelled', 'partially_completed'].includes(task.status)) return task
          await pause(50)
        }
        throw new Error(`Core task timeout: ${taskId}`)
      }
      function verify(task, capability, input, expectedPath, marker) {
        assert.equal(task.status, 'completed', JSON.stringify(task.error || task.output))
        assert.equal(task.output.verification.status, 'passed')
        assert.equal(task.output.verification.mode, 'office-artifact-readback')
        assert.equal(task.steps.length, 1)
        const result = task.output.steps[0].output
        assert.equal(hasVerifiedOfficeArtifact(capability, result, input, { agentRootDir }), true)
        assert.equal(result.taskId, task.id, 'Office 领域操作必须沿用 Core taskId')
        assert.equal(fs.realpathSync.native(result.data.path), fs.realpathSync.native(expectedPath))
        const bytes = fs.readFileSync(result.data.path)
        assert.equal(hash(bytes), result.data.artifact.sha256)
        assert.equal(bytes.length, result.data.artifact.bytes)
        const xml = new AdmZip(bytes).readAsText('word/document.xml')
        assert.ok(xml.includes(marker), `DOCX 缺少真实正文 ${marker}`)
        assert.ok(task.events.some(event => event.type === 'approval.required'))
        const record = task.events.filter(event => event.type === 'office.operation.updated').at(-1)?.payload?.record
        assert.equal(record.ownsCoreTask, false)
        assert.equal(record.phase, 'completed')
        assert.equal(record.stepId, task.plan.steps[0].id)
        return { taskId: task.id, status: task.status, verification: task.output.verification, artifact: result.data.artifact,
          markerFoundInDocxXml: true, operationIdentity: record.operationIdentity }
      }
      async function executeApproved(capability, input, key) {
        const before = registryCalls
        const pending = await runtime.submit({ intent: `Office Core acceptance ${key}`, mode: 'execute', input,
          requestedCapabilities: [capability], idempotencyKey: key, context: context(key) })
        assert.equal(pending.status, 'awaiting_approval')
        await pause(30)
        assert.equal(registryCalls, before, '审批前不得调用真实 registry')
        await runtime.approve(pending.id, 'user:local')
        const task = await terminal(pending.id)
        assert.equal(registryCalls, before + 1)
        report.steps.push({ name: 'Core terminal observation', key, taskId: task.id, status: task.status,
          error: task.error, operation: task.events.filter(event => event.type === 'office.operation.updated').at(-1)?.payload?.record })
        return task
      }

      const virtualInput = { content: { kind: 'html-fragment', value: '<h1>Core virtual output</h1><p>CORE VIRTUAL MARKER 7924</p>' },
        target: { format: 'docx', out: '/SANDBOX/reports/core-virtual.docx' }, options: { openAfterSave: false } }
      const virtualTask = await executeApproved('office_document_create', virtualInput, 'probe:core:virtual')
      report.steps.push({ name: 'Core approval → actual registry → Docs serialize → virtual SANDBOX delivery',
        ...verify(virtualTask, 'office_document_create', virtualInput, path.join(agentRootDir, 'SANDBOX', 'reports', 'core-virtual.docx'), 'CORE VIRTUAL MARKER 7924') })

      const relativeInput = { content: { kind: 'html-fragment', value: '<p>CORE RELATIVE MARKER 4682</p>' },
        target: { format: 'docx', out: 'reports/core-relative.docx' }, options: { openAfterSave: true } }
      const relativeTask = await executeApproved('office_document_create', relativeInput, 'probe:core:relative')
      const relativeResult = verify(relativeTask, 'office_document_create', relativeInput, path.join(agentRootDir, 'SANDBOX', 'reports', 'core-relative.docx'), 'CORE RELATIVE MARKER 4682')
      assert.equal(relativeResult.artifact.open.status, 'opened', JSON.stringify(relativeResult.artifact.open))
      report.steps.push({ name: 'Core relative SANDBOX path → actual DOCX delivery and editor open', ...relativeResult })

      const require = createRequire(path.join(root, 'vendor/happyoffice/apps/pdf/package.json'))
      const pdf = await require('pdf-lib').PDFDocument.create()
      pdf.addPage().drawText('CORE PDF CONVERSION MARKER 6813')
      const sourcePath = path.join(directory, 'core-source.pdf')
      fs.writeFileSync(sourcePath, await pdf.save())
      const sourceHash = hash(fs.readFileSync(sourcePath))
      const opened = await host.openOfficeFile(sourcePath)
      assert.equal(opened.success, true)
      const conversionInput = { source: { resourceId: opened.viewId }, target: { format: 'docx', out: '/SANDBOX/reports/core-converted.docx' }, options: { openAfterSave: false } }
      const conversionTask = await executeApproved('office_document_convert', conversionInput, 'probe:core:convert')
      report.steps.push({ name: 'Core approval → actual registry → current PDF snapshot → worker → verified DOCX',
        ...verify(conversionTask, 'office_document_convert', conversionInput, path.join(agentRootDir, 'SANDBOX', 'reports', 'core-converted.docx'), 'CORE PDF CONVERSION MARKER 6813'),
        sourceSha256Before: sourceHash, sourceSha256After: hash(fs.readFileSync(sourcePath)) })
      assert.equal(hash(fs.readFileSync(sourcePath)), sourceHash, 'Core 转换不得保存或改写原 PDF')

      const negativeRuntime = createAiCoreRuntime({ facade, executeCapability: async () => ({ ok: true, status: 'succeeded' }) })
      const negative = await negativeRuntime.submit({ intent: 'strict evidence negative fixture', mode: 'execute', input: {},
        requestedCapabilities: ['office_document_create'], idempotencyKey: 'probe:negative-contract', context: context('probe:negative-contract') })
      await negativeRuntime.approve(negative.id, 'user:local')
      let negativeResult
      for (let i = 0; i < 200; i++) {
        negativeResult = negativeRuntime.get(negative.id, 'user:local')
        if (negativeResult.status === 'failed') break
        await pause(10)
      }
      assert.equal(negativeResult.status, 'failed')
      assert.equal(negativeResult.error.code, 'AI_CORE_OUTPUT_NOT_VERIFIED')
      report.steps.push({ name: 'negative contract fixture: success text without artifact is rejected', fixtureOnly: true,
        status: negativeResult.status, code: negativeResult.error.code })

      const audits = db.queryAllRaw('SELECT arguments, output FROM agent_tool_logs WHERE toolName IN (?, ?)', ['office_document_create', 'office_document_convert'])
      assert.equal(audits.length, 3)
      assert.equal(JSON.stringify(audits).includes('CORE VIRTUAL MARKER'), false)
      assert.equal(JSON.stringify(audits).includes('CORE RELATIVE MARKER'), false)
      report.steps.push({ name: 'real registry audit hides generated HTML content', count: audits.length, privateMarkersAbsent: true })
      report.ok = true
    } catch (error) {
      report.error = error.stack || String(error)
      console.error(report.error)
    } finally {
      fs.mkdirSync(path.dirname(reportFile), { recursive: true })
      fs.writeFileSync(reportFile, JSON.stringify(report, null, 2))
      host.shutdownOfficeHost()
      db.closeDb()
      if (win && !win.isDestroyed()) win.destroy()
      app.exit(report.ok ? 0 : 1)
    }
  })
}
