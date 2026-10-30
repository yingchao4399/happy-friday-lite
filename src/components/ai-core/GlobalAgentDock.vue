<template>
  <div v-show="assistantSettings.visible" class="agent-dock" :class="{ 'agent-dock--office-overlay': officeOverlay, 'agent-dock--compact': assistantSettings.appearance === 'compact' }" :style="dockStyle">
    <section v-if="open" ref="panel" class="agent-dock-panel" role="region" :aria-label="t('common.agentDock.title')">
      <header class="agent-dock-header" @pointerdown="startDrag">
        <div>
          <strong>{{ t('common.agentDock.title') }}</strong>
          <span class="agent-dock-caption">{{ t('common.agentDock.subtitle') }}</span>
        </div>
        <div class="agent-dock-header-actions">
          <span class="agent-dock-grip" aria-hidden="true">⠿</span>
          <button class="agent-dock-icon-button" type="button" :aria-label="t('common.agentDock.close')" @pointerdown.stop @click="open = false">×</button>
        </div>
      </header>

      <div class="agent-dock-context" :aria-label="t('common.agentDock.contextTitle')">
        <div class="agent-dock-context-row">
          <span class="agent-dock-context-label">{{ t('common.agentDock.agentLabel') }}</span>
          <span class="agent-dock-context-value">{{ t('common.agentDock.coreAgent') }}</span>
        </div>
        <div class="agent-dock-context-row">
          <span class="agent-dock-context-label">{{ t('common.agentDock.selectedAgentLabel') }}</span>
          <span class="agent-dock-context-value">{{ t(`common.agentDock.agents.${assistantSettings.agentId}`) }}</span>
        </div>
        <div class="agent-dock-context-row">
          <span class="agent-dock-context-label">{{ t('common.agentDock.modeLabel') }}</span>
          <span class="agent-dock-context-value">{{ t(`common.agentDock.modes.${assistantSettings.mode}`) }}</span>
        </div>
        <p class="agent-dock-context-note" role="status">{{ t('common.agentDock.agentUnavailable') }}</p>
        <div class="agent-dock-context-row">
          <span class="agent-dock-context-label">{{ t('common.agentDock.routeLabel') }}</span>
          <span class="agent-dock-context-value" :title="routePath">{{ routeLabel }}</span>
        </div>
        <p class="agent-dock-context-note">{{ t('common.agentDock.contextReadonly') }}</p>
        <div class="agent-dock-context-row">
          <span class="agent-dock-context-label">{{ t('common.agentDock.resourceLabel') }}</span>
          <code class="agent-dock-context-resource" :title="resourceId">{{ resourceId }}</code>
        </div>
        <div class="agent-dock-context-capabilities">
          <span class="agent-dock-context-label">{{ t('common.agentDock.capabilitiesLabel') }}</span>
          <span v-if="capabilitiesLoading" class="agent-dock-context-value">{{ t('common.agentDock.capabilitiesLoading') }}</span>
          <span v-else-if="capabilitiesError" class="agent-dock-context-value">{{ t('common.agentDock.capabilitiesFailed') }}</span>
          <span v-else-if="!capabilities.length" class="agent-dock-context-value">{{ t('common.agentDock.capabilitiesEmpty') }}</span>
          <span v-else class="agent-dock-capability-list">
            <span v-for="capability in capabilities.slice(0, 5)" :key="capability.id || capability.name" class="agent-dock-capability">{{ capability.id || capability.name }}</span>
            <span v-if="capabilities.length > 5" class="agent-dock-capability-more">+{{ capabilities.length - 5 }}</span>
          </span>
        </div>
      </div>

      <section class="agent-dock-chat" :aria-label="t('common.agentDock.chatTitle')">
        <div class="agent-dock-chat-heading">
          <strong>{{ t('common.agentDock.chatTitle') }}</strong>
          <button type="button" class="agent-dock-small-button" @click="startNewDockChat">{{ t('common.agentDock.newChat') }}</button>
        </div>
        <input v-model="historyQuery" class="agent-dock-history-search" type="search" :placeholder="t('common.agentDock.historySearch')" />
        <div class="agent-dock-history-list">
          <button v-for="session in filteredHistorySessions" :key="session.id" type="button" class="agent-dock-history-item" :class="{ 'is-active': session.id === dockSessionId }" @click="selectHistory(session)">
            <span>{{ session.title || t('common.agentDock.taskFallback') }}</span>
            <small>{{ formatHistoryDate(session.updatedAt) }}</small>
          </button>
          <span v-if="historyLoading" class="agent-dock-history-empty">{{ t('common.agentDock.historyLoading') }}</span>
          <span v-else-if="!filteredHistorySessions.length" class="agent-dock-history-empty">{{ t('common.agentDock.historyEmpty') }}</span>
        </div>
        <div class="agent-dock-chat-messages" aria-live="polite">
          <div v-for="(message, index) in dockMessages" :key="`${message.requestId || 'local'}-${index}`" class="agent-dock-chat-message" :class="`message-${message.role}`">{{ message.content }}</div>
        </div>
        <form class="agent-dock-composer" @submit.prevent="sendDockMessage">
          <textarea v-model="dockInput" rows="2" :disabled="dockSending" :placeholder="t('common.agentDock.inputPlaceholder')" @keydown.enter.exact.prevent="sendDockMessage" />
          <button type="submit" :disabled="dockSending || !dockInput.trim()">{{ dockSending ? t('common.agentDock.sending') : t('common.agentDock.send') }}</button>
        </form>
      </section>

      <p v-if="error" class="agent-dock-error" role="alert">{{ error }}</p>
      <div v-if="loading && !tasks.length" class="agent-dock-empty">{{ t('common.agentDock.loading') }}</div>
      <div v-else-if="!tasks.length" class="agent-dock-empty">{{ t('common.agentDock.empty') }}</div>
      <ul v-else class="agent-dock-list">
        <li v-for="task in tasks" :key="task.id" class="agent-dock-task">
          <div class="agent-dock-task-heading">
            <span class="agent-dock-task-name">{{ task.intent || t('common.agentDock.taskFallback') }}</span>
            <span class="agent-dock-status" :class="`status-${task.status}`">{{ statusLabel(task.status) }}</span>
          </div>
          <p v-if="task.error?.message" class="agent-dock-task-error">{{ task.error.message }}</p>
          <div class="agent-dock-actions">
            <button v-if="task.status === 'awaiting_approval'" type="button" @click="requestApproval(task)">{{ t('common.agentDock.review') }}</button>
            <button v-if="['running', 'verifying'].includes(task.status) && !task.pauseRequested" type="button" :disabled="busyTaskId === task.id" @click="controlTask(task, 'pause')">{{ t('common.agentDock.pause') }}</button>
            <button v-if="task.status === 'paused'" type="button" :disabled="busyTaskId === task.id" @click="controlTask(task, 'resume')">{{ t('common.agentDock.resume') }}</button>
            <button v-if="['awaiting_approval', 'running', 'verifying', 'paused'].includes(task.status)" class="danger" type="button" :disabled="busyTaskId === task.id" @click="requestCancel(task)">{{ t('common.agentDock.cancelTask') }}</button>
          </div>
        </li>
      </ul>
      <footer class="agent-dock-footer">
        <button type="button" @click="openFriday">{{ t('common.agentDock.openFriday') }}</button>
        <button type="button" :disabled="loading" @click="refreshTasks">{{ t('common.agentDock.refresh') }}</button>
      </footer>
    </section>

    <button class="agent-dock-trigger" type="button" :aria-label="t(open ? 'common.agentDock.close' : 'common.agentDock.open')" :aria-expanded="open" @pointerdown="startTriggerDrag" @click="toggle">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v9a2.5 2.5 0 0 1-2.5 2.5H11l-4.5 4v-4H6.5A2.5 2.5 0 0 1 4 14.5z"/><path d="M8 9h8M8 12h5"/></svg>
      <span v-if="activeCount" class="agent-dock-badge">{{ activeCount }}</span>
    </button>

    <FridayConfirmDialog
      :visible="!!approvalTask"
      :title="t('common.agentDock.approvalTitle')"
      :message="approvalMessage"
      :cancel-label="t('common.action.cancel')"
      :confirm-label="t('common.agentDock.approve')"
      @cancel="approvalTask = null"
      @confirm="approveTask"
    />
    <FridayConfirmDialog
      :visible="!!cancelTask"
      :title="t('common.agentDock.cancelTitle')"
      :message="t('common.agentDock.cancelMessage')"
      :cancel-label="t('common.action.cancel')"
      :confirm-label="t('common.agentDock.cancelTask')"
      @cancel="cancelTask = null"
      @confirm="confirmCancelTask"
    />
  </div>
</template>

<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import FridayConfirmDialog from '@/components/ui/FridayConfirmDialog.vue'
import { electronService } from '@/services/electron'
import { loadModelConfig } from '@/views/friday/composables/useModelCatalog'

const { t } = useI18n()
const props = defineProps({ officeOverlay: { type: Boolean, default: false } })
const router = useRouter()
const route = useRoute()
const panel = ref(null)
const open = ref(false)
const tasks = ref([])
const loading = ref(false)
const capabilities = ref([])
const capabilitiesLoading = ref(false)
const capabilitiesError = ref(false)
const error = ref('')
const busyTaskId = ref('')
const approvalTask = ref(null)
const cancelTask = ref(null)
const historySessions = ref([])
const historyQuery = ref('')
const historyLoading = ref(false)
const dockMessages = ref([])
const dockInput = ref('')
const dockSending = ref(false)
const dockPosition = ref(null)
const dockSessionId = ref('')
const assistantSettings = ref({ visible: true, appearance: 'default', mode: 'auto', agentId: 'friday' })
let dockRequestId = ''
let dragState = null
let triggerDragMoved = false
let suppressTriggerClick = false
let unlistenDockChunk = null
let unlistenDockDone = null
let unlistenDockError = null
let unlistenDockSession = null
let unlistenDockSessionCreated = null
let unlistenAssistantConfig = null
let refreshTimer = null
let resizeObserver = null

const activeCount = computed(() => tasks.value.filter(task => ['awaiting_approval', 'running', 'verifying', 'paused'].includes(task.status)).length)
const filteredHistorySessions = computed(() => {
  const query = historyQuery.value.trim().toLowerCase()
  return historySessions.value.filter(session => !query || String(session.title || '').toLowerCase().includes(query)).slice(0, 30)
})
const dockStyle = computed(() => {
  if (props.officeOverlay || !dockPosition.value) return undefined
  return { left: `${dockPosition.value.x}px`, top: `${dockPosition.value.y}px`, right: 'auto', bottom: 'auto' }
})
const routePath = computed(() => route.path || '/')
const routeLabel = computed(() => {
  const path = routePath.value
  if (path.startsWith('/share/note')) return t('common.agentDock.pages.notes')
  if (path.startsWith('/share/drawing')) return t('common.agentDock.pages.drawing')
  if (path.startsWith('/friday') || path.startsWith('/share/')) return t('common.agentDock.pages.friday')
  if (path.startsWith('/note')) return t('common.agentDock.pages.notes')
  if (path.startsWith('/office')) return t('common.agentDock.pages.office')
  if (path.startsWith('/knowledge') || path.startsWith('/file-viewer')) return t('common.agentDock.pages.knowledge')
  if (path.startsWith('/drawing')) return t('common.agentDock.pages.drawing')
  if (path.startsWith('/history')) return t('common.agentDock.pages.history')
  if (path.startsWith('/settings')) return t('common.agentDock.pages.settings')
  if (path.startsWith('/typewriter')) return t('common.agentDock.pages.typewriter')
  if (path.startsWith('/schedule')) return t('common.agentDock.pages.schedule')
  if (path.startsWith('/automation')) return t('common.agentDock.pages.automation')
  if (path.startsWith('/clipboard')) return t('common.agentDock.pages.clipboard')
  if (path.startsWith('/trash')) return t('common.agentDock.pages.trash')
  if (path.startsWith('/recitation')) return t('common.agentDock.pages.recitation')
  if (path.startsWith('/harness')) return t('common.agentDock.pages.harness')
  return t('common.agentDock.pages.other')
})
const resourceId = computed(() => {
  const params = route.params || {}
  const key = ['id', 'instId', 'sessionId'].find(name => typeof params[name] === 'string' && params[name].trim())
  return key ? `${key}: ${params[key]}` : t('common.agentDock.noResource')
})
const approvalMessage = computed(() => {
  const steps = approvalTask.value?.plan?.steps?.map(step => step.capabilityId).filter(Boolean) || []
  const summary = steps.length ? steps.join('、') : t('common.agentDock.noStepDetails')
  return t('common.agentDock.approvalMessage', { intent: approvalTask.value?.intent || t('common.agentDock.taskFallback'), steps: summary })
})

function statusLabel(status) {
  const key = `common.agentDock.status.${status || 'unknown'}`
  const translated = t(key)
  return translated === key ? String(status || '') : translated
}

function formatHistoryDate(value) {
  if (!value) return ''
  try { return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(value)) } catch { return '' }
}

async function refreshHistory() {
  historyLoading.value = true
  try {
    const sessions = await electronService.invoke('get_sessions', { scope: 'friday-dock', scopeKey: null })
    historySessions.value = Array.isArray(sessions) ? sessions : []
  } catch { historySessions.value = [] } finally { historyLoading.value = false }
}

async function selectHistory(session) {
  if (!session?.id || historyLoading.value) return
  historyLoading.value = true
  error.value = ''
  try {
    const messages = await electronService.invoke('get_session_messages', {
      sessionId: session.id,
      scope: 'friday-dock',
      scopeKey: null
    })
    dockSessionId.value = session.id
    dockMessages.value = (Array.isArray(messages) ? messages : [])
      .filter(message => message && (message.role === 'user' || message.role === 'assistant'))
      .map(message => ({
        role: message.role,
        content: String(message.content || ''),
        requestId: `history_${session.id}`
      }))
    open.value = true
    await nextTick()
    const messageList = panel.value?.querySelector('.agent-dock-chat-messages')
    if (messageList) messageList.scrollTop = messageList.scrollHeight
  } catch (err) {
    error.value = err?.message || t('common.agentDock.historyLoadFailed')
  } finally {
    historyLoading.value = false
  }
}

function startNewDockChat() {
  dockMessages.value = []
  dockInput.value = ''
  dockSessionId.value = ''
  dockRequestId = ''
}

async function sendDockMessage() {
  const message = dockInput.value.trim()
  if (!message || dockSending.value) return
  const model = loadModelConfig()
  if (!model?.apiKey || !model?.modelName || !(model?.baseUrl || model?.modelUrl)) {
    error.value = t('common.agentDock.modelMissing')
    return
  }
  dockInput.value = ''
  const requestId = `dock_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  dockRequestId = requestId
  dockSending.value = true
  dockMessages.value.push({ role: 'user', content: message, requestId })
  dockMessages.value.push({ role: 'assistant', content: '', requestId })
  try {
    const result = await electronService.invoke('chat_with_memory', {
      requestId, sessionId: dockSessionId.value || '', model, message, enableThinking: false,
      scope: 'friday-dock', scopeKey: null, attachments: [],
      agentId: assistantSettings.value.agentId,
      agentMode: assistantSettings.value.mode
    })
    if (result?.sessionId) dockSessionId.value = result.sessionId
    await refreshHistory()
  } catch (err) {
    const assistant = dockMessages.value.at(-1)
    if (assistant?.role === 'assistant') assistant.content = err?.message || t('common.agentDock.chatFailed')
  } finally { dockSending.value = false }
}

function startDrag(event) {
  if (event.button !== 0 || event.target?.closest('button')) return
  const root = event.currentTarget?.closest('.agent-dock')
  const rect = root?.getBoundingClientRect()
  if (!rect) return
  dragState = { offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top, lastX: event.clientX, lastY: event.clientY }
  window.addEventListener('pointermove', moveDrag)
  window.addEventListener('pointerup', stopDrag, { once: true })
  event.currentTarget?.setPointerCapture?.(event.pointerId)
}
function startTriggerDrag(event) {
  if (event.button !== 0) return
  const root = event.currentTarget?.closest('.agent-dock')
  const rect = root?.getBoundingClientRect()
  if (!rect) return
  triggerDragMoved = false
  dragState = { offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top, startX: event.clientX, startY: event.clientY, lastX: event.clientX, lastY: event.clientY, trigger: true }
  window.addEventListener('pointermove', moveDrag)
  window.addEventListener('pointerup', stopTriggerDrag, { once: true })
}
function moveDrag(event) {
  if (!dragState) return
  if (dragState.trigger && Math.hypot(event.clientX - dragState.startX, event.clientY - dragState.startY) > 4) triggerDragMoved = true
  if (props.officeOverlay) {
    const dx = event.clientX - dragState.lastX
    const dy = event.clientY - dragState.lastY
    dragState.lastX = event.clientX
    dragState.lastY = event.clientY
    if (dx || dy) electronService.request('office-dock-move', { dx, dy }).catch(() => {})
    return
  }
  const width = panel.value?.parentElement?.getBoundingClientRect?.().width || 52
  const height = panel.value?.parentElement?.getBoundingClientRect?.().height || 52
  const x = Math.max(8, Math.min(window.innerWidth - width - 8, event.clientX - dragState.offsetX))
  const y = Math.max(8, Math.min(window.innerHeight - height - 8, event.clientY - dragState.offsetY))
  dockPosition.value = { x, y }
}
function stopDrag() {
  if (dockPosition.value) localStorage.setItem('happy-friday-dock-position', JSON.stringify(dockPosition.value))
  dragState = null
  window.removeEventListener('pointermove', moveDrag)
}
function stopTriggerDrag() {
  if (triggerDragMoved) suppressTriggerClick = true
  stopDrag()
  window.setTimeout(() => { suppressTriggerClick = false }, 0)
}

async function refreshTasks() {
  if (loading.value) return
  loading.value = true
  error.value = ''
  try {
    const result = await electronService.aiCoreListTasks()
    tasks.value = (Array.isArray(result) ? result : []).sort((a, b) => String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || ''))).slice(0, 8)
  } catch (_error) {
    error.value = t('common.agentDock.loadFailed')
  } finally {
    loading.value = false
  }
}

async function refreshCapabilities() {
  capabilitiesLoading.value = true
  capabilitiesError.value = false
  try {
    const result = await electronService.aiCoreListCapabilities()
    capabilities.value = Array.isArray(result?.capabilities) ? result.capabilities : []
    capabilitiesError.value = !Array.isArray(result?.capabilities)
  } catch (_error) {
    capabilities.value = []
    capabilitiesError.value = true
  } finally {
    capabilitiesLoading.value = false
  }
}

function toggle() {
  if (suppressTriggerClick) return
  open.value = !open.value
  syncOfficeOverlayBounds()
  if (open.value) {
    refreshTasks()
    refreshCapabilities()
  }
}

async function controlTask(task, action) {
  if (busyTaskId.value) return
  busyTaskId.value = task.id
  try {
    if (action === 'pause') await electronService.aiCorePauseTask(task.id)
    else await electronService.aiCoreResumeTask(task.id)
    await refreshTasks()
  } catch (_error) {
    error.value = t('common.agentDock.actionFailed')
  } finally {
    busyTaskId.value = ''
  }
}

function requestApproval(task) {
  approvalTask.value = task
}

async function approveTask() {
  const task = approvalTask.value
  approvalTask.value = null
  if (!task || busyTaskId.value) return
  busyTaskId.value = task.id
  try {
    await electronService.aiCoreApproveTask(task.id)
    await refreshTasks()
  } catch (_error) {
    error.value = t('common.agentDock.actionFailed')
  } finally {
    busyTaskId.value = ''
  }
}

function requestCancel(task) {
  cancelTask.value = task
}

async function confirmCancelTask() {
  const task = cancelTask.value
  cancelTask.value = null
  if (!task || busyTaskId.value) return
  busyTaskId.value = task.id
  try {
    await electronService.aiCoreCancelTask(task.id)
    await refreshTasks()
  } catch (_error) {
    error.value = t('common.agentDock.actionFailed')
  } finally {
    busyTaskId.value = ''
  }
}

function openFriday() {
  open.value = false
  if (props.officeOverlay) {
    electronService.request('office-dock-open-friday').catch(() => {})
    syncOfficeOverlayBounds()
  } else {
    router.push('/friday')
  }
}

function syncOfficeOverlayBounds() {
  if (!props.officeOverlay) return
  const panelHeight = open.value ? Math.ceil(panel.value?.getBoundingClientRect?.().height || 360) : 0
  electronService.request('office-dock-set-expanded', { expanded: open.value, panelHeight }).catch(() => {})
}

watch(open, async () => {
  if (!props.officeOverlay) return
  await nextTick()
  if (resizeObserver && panel.value) resizeObserver.observe(panel.value)
  syncOfficeOverlayBounds()
})

onMounted(() => {
  const applyAssistantSettings = (config) => {
    const saved = config?.globalAgentDock || {}
    assistantSettings.value = {
      visible: saved.visible !== false,
      appearance: saved.appearance === 'compact' ? 'compact' : 'default',
      mode: ['friday', 'researcher', 'auto'].includes(saved.mode) ? saved.mode : 'auto',
      agentId: ['friday', 'researcher'].includes(saved.agentId) ? saved.agentId : 'friday'
    }
  }
  electronService.invoke('get-config').then(applyAssistantSettings).catch(() => {})
  unlistenAssistantConfig = electronService.listen('config-changed', ({ payload }) => applyAssistantSettings(payload))
  try {
    const saved = JSON.parse(localStorage.getItem('happy-friday-dock-position') || 'null')
    if (Number.isFinite(saved?.x) && Number.isFinite(saved?.y)) dockPosition.value = saved
  } catch { /* ignore corrupt position */ }
  refreshHistory()
  // Tasks are refreshed when the dock opens or after an action. Avoid a
  // six-second IPC poll that made opening the panel compete with the editor.
  refreshTasks()
  unlistenDockChunk = electronService.listen('chat-chunk', ({ payload }) => {
    if (!payload || payload.requestId !== dockRequestId) return
    const assistant = dockMessages.value.at(-1)
    if (assistant?.role === 'assistant') assistant.content += String(payload.content || '')
  })
  unlistenDockSessionCreated = electronService.listen('chat-session-created', ({ payload }) => {
    if (!payload || payload.requestId !== dockRequestId || !payload.sessionId) return
    dockSessionId.value = payload.sessionId
  })
  unlistenDockDone = electronService.listen('chat-done', ({ payload }) => {
    if (!payload || payload.requestId !== dockRequestId) return
    const assistant = dockMessages.value.at(-1)
    if (assistant?.role === 'assistant' && payload.fullContent) assistant.content = payload.fullContent
    if (payload.sessionId) dockSessionId.value = payload.sessionId
    dockSending.value = false
    refreshHistory()
  })
  unlistenDockError = electronService.listen('chat-error', ({ payload }) => {
    if (!payload || payload.requestId !== dockRequestId) return
    const assistant = dockMessages.value.at(-1)
    if (assistant?.role === 'assistant') assistant.content = payload.error || t('common.agentDock.chatFailed')
    if (payload.sessionId && !dockSessionId.value) dockSessionId.value = payload.sessionId
    dockSending.value = false
  })
  unlistenDockSession = electronService.listen('session-title-updated', ({ payload }) => {
    if (payload?.sessionId) refreshHistory()
  })
  if (props.officeOverlay) {
    resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(syncOfficeOverlayBounds) : null
    if (resizeObserver && panel.value) resizeObserver.observe(panel.value)
    syncOfficeOverlayBounds()
  }
})

watch(routePath, () => {
  if (open.value) refreshCapabilities()
})

onUnmounted(() => {
  window.clearInterval(refreshTimer)
  unlistenDockChunk?.(); unlistenDockSessionCreated?.(); unlistenDockDone?.(); unlistenDockError?.(); unlistenDockSession?.()
  unlistenAssistantConfig?.()
  window.removeEventListener('pointermove', moveDrag)
  resizeObserver?.disconnect()
  if (props.officeOverlay) electronService.request('office-dock-set-expanded', { expanded: false }).catch(() => {})
})
</script>

<style scoped>
.agent-dock { position: fixed; right: 22px; bottom: 22px; z-index: 1800; font-family: inherit; color: var(--text-primary); }
.agent-dock--compact .agent-dock-trigger { width: 40px; height: 40px; }
.agent-dock--compact .agent-dock-trigger svg { width: 19px; height: 19px; }
.agent-dock--compact .agent-dock-panel { width: min(320px, calc(100vw - 32px)); }
.agent-dock--compact .agent-dock-header { padding: 11px 13px 9px; }
.agent-dock--office-overlay { right: 0; bottom: 0; }
.agent-dock-trigger { position: relative; display: grid; place-items: center; width: 48px; height: 48px; border: 1px solid var(--border-color); border-radius: 50%; background: var(--bg-primary); color: var(--text-primary); box-shadow: 0 6px 22px #0002; cursor: pointer; }
.agent-dock-trigger svg { width: 22px; height: 22px; fill: none; stroke: currentColor; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; }
.agent-dock-badge { position: absolute; top: -3px; right: -3px; min-width: 18px; height: 18px; padding: 0 4px; border-radius: 10px; background: var(--accent-color, #6558dc); color: #fff; font-size: 11px; line-height: 18px; }
.agent-dock-panel { position: absolute; right: 0; bottom: 60px; display: flex; flex-direction: column; width: min(360px, calc(100vw - 32px)); max-height: min(520px, calc(100vh - 110px)); overflow: hidden; border: 1px solid var(--border-color); border-radius: 14px; background: var(--bg-primary); box-shadow: 0 12px 40px #0003; }
.agent-dock--office-overlay .agent-dock-panel { right: 0; bottom: 48px; width: min(360px, 100vw); max-height: calc(100vh - 48px); border-radius: 14px 0 0 14px; }
.agent-dock-header { display: flex; align-items: flex-start; justify-content: space-between; padding: 15px 16px 12px; border-bottom: 1px solid var(--border-color); cursor: move; user-select: none; }
.agent-dock-header-actions { display: flex; align-items: center; gap: 5px; }
.agent-dock-grip { color: var(--text-secondary); font-size: 17px; line-height: 26px; }
.agent-dock-header strong { display: block; font-size: 14px; }
.agent-dock-caption { display: block; margin-top: 3px; color: var(--text-secondary); font-size: 12px; }
.agent-dock-icon-button { width: 26px; height: 26px; border: 0; border-radius: 6px; background: transparent; color: inherit; font-size: 20px; cursor: pointer; }
.agent-dock-context { display: grid; gap: 6px; padding: 10px 14px; border-bottom: 1px solid var(--border-color); background: var(--bg-secondary); font-size: 11px; }
.agent-dock-context-row, .agent-dock-context-capabilities { display: flex; align-items: baseline; gap: 8px; min-width: 0; }
.agent-dock-context-label { flex: none; color: var(--text-secondary); }
.agent-dock-context-value { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.agent-dock-context-note { margin: -2px 0 2px; color: var(--text-secondary); line-height: 1.35; }
.agent-dock-context-note[role="status"] { padding: 5px 7px; border-radius: 6px; background: var(--bg-primary); }
.agent-dock-context-resource { overflow: hidden; color: var(--text-secondary); text-overflow: ellipsis; white-space: nowrap; }
.agent-dock-chat { display: flex; flex-direction: column; min-height: 0; padding: 10px 14px 0; border-bottom: 1px solid var(--border-color); }
.agent-dock-chat-heading { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 7px; font-size: 12px; }
.agent-dock-small-button { border: 0; background: transparent; color: var(--accent-color, #6558dc); font: inherit; cursor: pointer; }
.agent-dock-history-search { width: 100%; box-sizing: border-box; padding: 6px 8px; border: 1px solid var(--border-color); border-radius: 7px; background: var(--bg-primary); color: inherit; font: inherit; font-size: 11px; }
.agent-dock-history-list { max-height: 115px; overflow: auto; margin-top: 6px; }
.agent-dock-history-item { display: flex; align-items: center; justify-content: space-between; gap: 7px; width: 100%; padding: 6px 4px; border: 0; border-radius: 5px; background: transparent; color: inherit; text-align: left; font: inherit; font-size: 11px; cursor: pointer; }
.agent-dock-history-item:hover, .agent-dock-history-item.is-active { background: var(--bg-secondary); }
.agent-dock-history-item span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.agent-dock-history-item small { flex: none; color: var(--text-secondary); }
.agent-dock-history-empty { display: block; padding: 8px 2px; color: var(--text-secondary); font-size: 11px; }
.agent-dock-chat-messages { display: flex; flex-direction: column; gap: 5px; max-height: 125px; overflow: auto; padding: 8px 0; }
.agent-dock-chat-message { max-width: 88%; padding: 6px 8px; border-radius: 8px; white-space: pre-wrap; word-break: break-word; font-size: 12px; line-height: 1.4; }
.agent-dock-chat-message.message-user { align-self: flex-end; background: var(--accent-color, #6558dc); color: #fff; }
.agent-dock-chat-message.message-assistant { align-self: flex-start; background: var(--bg-secondary); }
.agent-dock-composer { display: flex; align-items: flex-end; gap: 6px; padding: 4px 0 10px; }
.agent-dock-composer textarea { flex: 1; min-width: 0; resize: vertical; padding: 7px 8px; border: 1px solid var(--border-color); border-radius: 8px; background: var(--bg-primary); color: inherit; font: inherit; font-size: 12px; line-height: 1.35; }
.agent-dock-composer button { flex: none; padding: 7px 9px; border: 1px solid var(--accent-color, #6558dc); border-radius: 7px; background: var(--accent-color, #6558dc); color: #fff; font: inherit; font-size: 11px; cursor: pointer; }
.agent-dock-composer button:disabled { opacity: .5; cursor: default; }
.agent-dock-capability-list { display: flex; flex-wrap: wrap; gap: 4px; min-width: 0; }
.agent-dock-capability, .agent-dock-capability-more { max-width: 145px; overflow: hidden; padding: 2px 5px; border: 1px solid var(--border-color); border-radius: 5px; text-overflow: ellipsis; white-space: nowrap; }
.agent-dock-capability-more { color: var(--text-secondary); }
.agent-dock-empty { padding: 22px 16px; color: var(--text-secondary); font-size: 13px; text-align: center; }
.agent-dock-error { margin: 10px 14px 0; color: var(--color-danger, #c0392b); font-size: 12px; }
.agent-dock-list { margin: 0; padding: 0 14px; overflow: auto; list-style: none; }
.agent-dock-task { padding: 12px 2px; border-bottom: 1px solid var(--border-color); }
.agent-dock-task-heading { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.agent-dock-task-name { overflow: hidden; font-size: 13px; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
.agent-dock-status { flex: none; padding: 3px 7px; border-radius: 999px; background: var(--bg-secondary); color: var(--text-secondary); font-size: 11px; }
.agent-dock-status.status-running, .agent-dock-status.status-verifying { color: var(--accent-color, #6558dc); }
.agent-dock-status.status-failed, .agent-dock-status.status-partially_completed { color: var(--color-danger, #c0392b); }
.agent-dock-task-error { margin: 7px 0 0; color: var(--color-danger, #c0392b); font-size: 12px; }
.agent-dock-actions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
.agent-dock-actions button, .agent-dock-footer button { border: 1px solid var(--border-color); border-radius: 7px; padding: 5px 8px; background: var(--bg-primary); color: inherit; font: inherit; font-size: 11px; cursor: pointer; }
.agent-dock-actions button.danger { color: var(--color-danger, #c0392b); }
.agent-dock-actions button:disabled, .agent-dock-footer button:disabled { opacity: .5; cursor: default; }
.agent-dock-footer { display: flex; justify-content: space-between; gap: 8px; padding: 11px 14px; }
@media (max-width: 600px) { .agent-dock:not(.agent-dock--office-overlay) { right: 14px; bottom: 14px; } .agent-dock-panel { width: min(390px, calc(100vw - 16px)); } }
@media (prefers-reduced-motion: reduce) { .agent-dock *, .agent-dock *::before, .agent-dock *::after { scroll-behavior: auto !important; transition-duration: 0s !important; } }
</style>
