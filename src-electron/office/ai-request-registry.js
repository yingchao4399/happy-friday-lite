import { createHash, randomUUID } from 'node:crypto'

const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled'])
const fault = code => Object.assign(new Error(code), { code })
const alive = sender => sender && typeof sender.isDestroyed === 'function' && !sender.isDestroyed()

// IPC 参数只接受 JSON 数据。按键排序，让相同参数的不同属性顺序不造成冲突。
// 摘要之外不保存正文、附件、工具输入、模型配置或密钥，错误也只带稳定错误码。
function parameterDigest(parameters, maxBytes) {
  const seen = new Set()
  const normalize = value => {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
    if (typeof value === 'number' && Number.isFinite(value)) return value
    if (!value || typeof value !== 'object' || seen.has(value)) throw fault('OFFICE_AI_PARAMETERS_INVALID')
    if (!Array.isArray(value) && ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw fault('OFFICE_AI_PARAMETERS_INVALID')
    seen.add(value)
    const result = Array.isArray(value)
      ? value.map(item => item === undefined ? null : normalize(item))
      : Object.fromEntries(Object.keys(value).sort().filter(key => value[key] !== undefined).map(key => [key, normalize(value[key])]))
    seen.delete(value)
    return result
  }
  let serialized
  try { serialized = JSON.stringify(normalize(parameters ?? null)) } catch { throw fault('OFFICE_AI_PARAMETERS_INVALID') }
  if (Buffer.byteLength(serialized, 'utf8') > maxBytes) throw fault('OFFICE_AI_PARAMETERS_TOO_LARGE')
  return createHash('sha256').update(serialized).digest('hex')
}

function requestIdentity(sender, requestId) {
  if (!sender || !Number.isSafeInteger(sender.id) || sender.id <= 0) throw fault('OFFICE_AI_SENDER_INVALID')
  if (typeof requestId !== 'string' || !requestId || requestId.length > 200 || /[\u0000-\u001f\u007f]/.test(requestId)) throw fault('OFFICE_AI_REQUEST_ID_INVALID')
  return JSON.stringify([sender.id, requestId])
}

function trustedOwner(resolveOwner, sender) {
  let owner
  try { owner = resolveOwner(sender) } catch { throw fault('OFFICE_AI_OWNER_UNAVAILABLE') }
  if (!owner || typeof owner.documentId !== 'string' || !owner.documentId || owner.documentId.length > 500 ||
    typeof owner.viewId !== 'string' || !owner.viewId || owner.viewId.length > 500) throw fault('OFFICE_AI_OWNER_UNAVAILABLE')
  return Object.freeze({ documentId: owner.documentId, viewId: owner.viewId })
}

/**
 * Office AI 流的宿主身份与生命周期登记表，不依赖 Electron。
 *
 * resolveOwner 必须同步从可信宿主视图登记表返回 documentId/viewId，不能读取
 * renderer 自报的身份。每个请求绑定 sender 对象、sender.id 和此身份快照；
 * sender 换文档后旧请求不得继续写入同一个 renderer。
 *
 * begin 返回 reused:true 时调用方不得再次启动模型请求。lease.emit 可直接替换
 * 原 sendSafe；done/error 自动进入终态，cancel 默认只发送一次 done。finally
 * 可以重复 finish，旧请求的迟到 finally 不会删除同 ID 的新请求。
 */
export function createOfficeAiRequestRegistry({
  resolveOwner,
  deliver = (sender, chunk) => sender.send('ai:stream-chunk', chunk),
  now = Date.now,
  terminalTtlMs = 300000,
  maxEntries = 512,
  maxParameterBytes = 32 * 1024 * 1024,
} = {}) {
  if (typeof resolveOwner !== 'function' || typeof deliver !== 'function' || typeof now !== 'function') throw new TypeError('Office AI 请求登记表需要可信身份解析器与发送器')
  if (!Number.isSafeInteger(maxEntries) || maxEntries < 1 || !Number.isSafeInteger(terminalTtlMs) || terminalTtlMs < 0 ||
    !Number.isSafeInteger(maxParameterBytes) || maxParameterBytes < 1) throw new TypeError('Office AI 请求登记表容量参数无效')
  const records = new Map()
  let disposed = false

  const metadata = record => Object.freeze({
    id: record.id, senderId: record.senderId, documentId: record.owner.documentId, viewId: record.owner.viewId,
    status: record.status, createdAt: record.createdAt, endedAt: record.endedAt,
  })
  const ownerMatches = (record, sender = record.sender) => {
    if (record.senderRef.deref() !== sender || !alive(sender)) return false
    try {
      const owner = trustedOwner(resolveOwner, sender)
      return owner.documentId === record.owner.documentId && owner.viewId === record.owner.viewId
    } catch { return false }
  }
  const remove = record => {
    if (records.get(record.key) === record) records.delete(record.key)
  }
  const prune = () => {
    const timestamp = now()
    for (const record of records.values()) {
      if (record.status !== 'active' && timestamp - record.endedAt >= terminalTtlMs) remove(record)
    }
  }
  const detach = record => {
    const sender = record.sender
    if (sender && record.destroyed) sender.removeListener('destroyed', record.destroyed)
    if (sender && record.crashed) sender.removeListener('render-process-gone', record.crashed)
    if (sender && record.navigated) sender.removeListener('did-start-navigation', record.navigated)
    record.destroyed = null
    record.crashed = null
    record.navigated = null
    record.sender = null
  }
  const deliverChunk = (record, sender, chunk) => {
    if (!chunk || typeof chunk !== 'object' || Array.isArray(chunk)) return false
    try {
      if (!alive(sender)) return false
      // 覆写 payload 内可能自报的 requestId，只向原 sender 发送。
      deliver(sender, { ...chunk, requestId: record.requestId })
      return true
    } catch { return false }
  }
  const terminate = (record, status, chunk, code, forget = false) => {
    if (record.status !== 'active') return false
    const sender = record.sender
    const mayDeliver = ownerMatches(record, sender)
    // 在发送或 abort 回调之前先落终态，防止同步重入造成重复 done/error。
    record.status = status
    record.endedAt = now()
    detach(record)
    if (status !== 'completed' && !record.controller.signal.aborted) record.controller.abort(fault(code || 'OFFICE_AI_REQUEST_CANCELLED'))
    if (chunk && mayDeliver) deliverChunk(record, sender, chunk)
    if (forget) remove(record)
    return true
  }
  const assertOwned = (sender, requestId) => {
    const key = requestIdentity(sender, requestId)
    const record = records.get(key)
    if (!record || record.senderRef.deref() !== sender) throw fault('OFFICE_AI_REQUEST_NOT_OWNED')
    if (!ownerMatches(record, sender)) {
      terminate(record, 'cancelled', null, 'OFFICE_AI_OWNER_CHANGED', true)
      throw fault('OFFICE_AI_OWNER_CHANGED')
    }
    return record
  }

  function begin({ sender, requestId, parameters } = {}) {
    if (disposed) throw fault('OFFICE_AI_REGISTRY_DISPOSED')
    const key = requestIdentity(sender, requestId)
    if (!alive(sender) || typeof sender.once !== 'function' || typeof sender.removeListener !== 'function') throw fault('OFFICE_AI_SENDER_INVALID')
    const owner = trustedOwner(resolveOwner, sender)
    const digest = parameterDigest(parameters, maxParameterBytes)
    prune()
    let previous = records.get(key)
    if (previous && previous.senderRef.deref() !== sender) {
      // Electron 回收 sender 数字 ID 后，旧终态不应占用新 sender 的命名空间。
      if (previous.status === 'active') throw fault('OFFICE_AI_REQUEST_NOT_OWNED')
      remove(previous)
      previous = null
    }
    if (previous) {
      if (previous.owner.documentId !== owner.documentId || previous.owner.viewId !== owner.viewId) {
        terminate(previous, 'cancelled', null, 'OFFICE_AI_OWNER_CHANGED', true)
        throw fault('OFFICE_AI_OWNER_CHANGED')
      }
      if (previous.digest !== digest) throw fault('OFFICE_AI_REQUEST_CONFLICT')
      return { lease: previous.lease, reused: true }
    }
    while (records.size >= maxEntries) {
      const terminal = [...records.values()].find(record => record.status !== 'active')
      if (!terminal) throw fault('OFFICE_AI_REQUEST_CAPACITY_REACHED')
      remove(terminal)
    }
    const record = {
      id: randomUUID(), key, requestId, senderId: sender.id, sender, senderRef: new WeakRef(sender), owner, digest,
      controller: new AbortController(), status: 'active', createdAt: now(), endedAt: null,
      destroyed: null, crashed: null, navigated: null, lease: null,
    }
    const finish = (status = 'completed', chunk) => {
      if (!TERMINAL_STATUSES.has(status)) throw fault('OFFICE_AI_TERMINAL_STATUS_INVALID')
      if (record.status !== 'active') return false
      if (!ownerMatches(record)) return terminate(record, 'cancelled', null, 'OFFICE_AI_OWNER_CHANGED', true) && false
      return terminate(record, status, chunk, status === 'failed' ? 'OFFICE_AI_REQUEST_FAILED' : undefined)
    }
    record.lease = Object.freeze({
      signal: record.controller.signal,
      metadata: () => metadata(record),
      emit(chunk) {
        if (record.status !== 'active') return false
        if (!ownerMatches(record)) { terminate(record, 'cancelled', null, 'OFFICE_AI_OWNER_CHANGED', true); return false }
        if (chunk?.type === 'done') return finish('completed', chunk)
        if (chunk?.type === 'error') return finish('failed', chunk)
        if (!deliverChunk(record, record.sender, chunk)) { terminate(record, 'cancelled', null, 'OFFICE_AI_SENDER_UNAVAILABLE', true); return false }
        return true
      },
      finish,
    })
    record.destroyed = () => { terminate(record, 'cancelled', null, 'OFFICE_AI_SENDER_DESTROYED', true) }
    record.crashed = () => { terminate(record, 'cancelled', null, 'OFFICE_AI_RENDERER_GONE', true) }
    record.navigated = (_event, detailsOrUrl, _inPlace, legacyMainFrame) => {
      const details = detailsOrUrl && typeof detailsOrUrl === 'object' ? detailsOrUrl : null
      const mainFrame = details ? details.isMainFrame : legacyMainFrame
      const sameDocument = details ? details.isSameDocument : _inPlace
      if (mainFrame === true && sameDocument !== true) {
        terminate(record, 'cancelled', null, 'OFFICE_AI_RENDERER_NAVIGATED', true)
      }
    }
    records.set(key, record)
    sender.once('destroyed', record.destroyed)
    sender.once('render-process-gone', record.crashed)
    sender.on('did-start-navigation', record.navigated)
    // 安装监听器期间已失效也必须收尾，不让请求越过绑定边界。
    if (!ownerMatches(record)) {
      terminate(record, 'cancelled', null, 'OFFICE_AI_OWNER_CHANGED', true)
      throw fault('OFFICE_AI_OWNER_CHANGED')
    }
    return { lease: record.lease, reused: false }
  }

  return Object.freeze({
    begin,
    cancelServices(sender) {
      const owner = trustedOwner(resolveOwner, sender)
      let count = 0
      for (const record of records.values()) {
        if (record.status === 'active' && record.senderRef.deref() === sender && record.owner.documentId === owner.documentId && record.requestId.startsWith('office-')) {
          if (terminate(record, 'cancelled', null, 'OFFICE_AI_REQUEST_CANCELLED')) count++
        }
      }
      return { cancelled: count }
    },
    cancel({ sender, requestId } = {}, terminalChunk = { type: 'done' }) {
      const record = assertOwned(sender, requestId)
      const cancelled = terminate(record, 'cancelled', terminalChunk, 'OFFICE_AI_REQUEST_CANCELLED')
      return { cancelled, status: record.status }
    },
    snapshot() { prune(); return [...records.values()].map(metadata) },
    dispose() {
      if (disposed) return false
      disposed = true
      for (const record of records.values()) terminate(record, 'cancelled', null, 'OFFICE_AI_REGISTRY_DISPOSED', true)
      records.clear()
      return true
    },
  })
}
