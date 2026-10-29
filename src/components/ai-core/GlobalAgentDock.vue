<template>
  <div class="agent-dock" :class="{ 'agent-dock--office-overlay': officeOverlay }">
    <section v-if="open" ref="panel" class="agent-dock-panel" role="region" :aria-label="t('common.agentDock.title')">
      <header class="agent-dock-header">
        <div>
          <strong>{{ t('common.agentDock.title') }}</strong>
          <span class="agent-dock-caption">{{ t('common.agentDock.subtitle') }}</span>
        </div>
        <button class="agent-dock-icon-button" type="button" :aria-label="t('common.agentDock.close')" @click="open = false">×</button>
      </header>

      <div class="agent-dock-context" :aria-label="t('common.agentDock.contextTitle')">
        <div class="agent-dock-context-row">
          <span class="agent-dock-context-label">{{ t('common.agentDock.agentLabel') }}</span>
          <span class="agent-dock-context-value">{{ t('common.agentDock.coreAgent') }}</span>
        </div>
        <p class="agent-dock-context-note">{{ t('common.agentDock.agentUnavailable') }}</p>
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

    <button class="agent-dock-trigger" type="button" :aria-label="t(open ? 'common.agentDock.close' : 'common.agentDock.open')" :aria-expanded="open" @click="toggle">
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
let refreshTimer = null
let resizeObserver = null

const activeCount = computed(() => tasks.value.filter(task => ['awaiting_approval', 'running', 'verifying', 'paused'].includes(task.status)).length)
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
  refreshTasks()
  refreshTimer = window.setInterval(refreshTasks, 6000)
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
  resizeObserver?.disconnect()
  if (props.officeOverlay) electronService.request('office-dock-set-expanded', { expanded: false }).catch(() => {})
})
</script>

<style scoped>
.agent-dock { position: fixed; right: 22px; bottom: 22px; z-index: 1800; font-family: inherit; color: var(--text-primary); }
.agent-dock--office-overlay { right: 0; bottom: 0; }
.agent-dock-trigger { position: relative; display: grid; place-items: center; width: 48px; height: 48px; border: 1px solid var(--border-color); border-radius: 50%; background: var(--bg-primary); color: var(--text-primary); box-shadow: 0 6px 22px #0002; cursor: pointer; }
.agent-dock-trigger svg { width: 22px; height: 22px; fill: none; stroke: currentColor; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; }
.agent-dock-badge { position: absolute; top: -3px; right: -3px; min-width: 18px; height: 18px; padding: 0 4px; border-radius: 10px; background: var(--accent-color, #6558dc); color: #fff; font-size: 11px; line-height: 18px; }
.agent-dock-panel { position: absolute; right: 0; bottom: 60px; display: flex; flex-direction: column; width: min(360px, calc(100vw - 32px)); max-height: min(520px, calc(100vh - 110px)); overflow: hidden; border: 1px solid var(--border-color); border-radius: 14px; background: var(--bg-primary); box-shadow: 0 12px 40px #0003; }
.agent-dock--office-overlay .agent-dock-panel { right: 0; bottom: 48px; width: min(360px, 100vw); max-height: calc(100vh - 48px); border-radius: 14px 0 0 14px; }
.agent-dock-header { display: flex; align-items: flex-start; justify-content: space-between; padding: 15px 16px 12px; border-bottom: 1px solid var(--border-color); }
.agent-dock-header strong { display: block; font-size: 14px; }
.agent-dock-caption { display: block; margin-top: 3px; color: var(--text-secondary); font-size: 12px; }
.agent-dock-icon-button { width: 26px; height: 26px; border: 0; border-radius: 6px; background: transparent; color: inherit; font-size: 20px; cursor: pointer; }
.agent-dock-context { display: grid; gap: 6px; padding: 10px 14px; border-bottom: 1px solid var(--border-color); background: var(--bg-secondary); font-size: 11px; }
.agent-dock-context-row, .agent-dock-context-capabilities { display: flex; align-items: baseline; gap: 8px; min-width: 0; }
.agent-dock-context-label { flex: none; color: var(--text-secondary); }
.agent-dock-context-value { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.agent-dock-context-note { margin: -2px 0 2px; color: var(--text-secondary); line-height: 1.35; }
.agent-dock-context-resource { overflow: hidden; color: var(--text-secondary); text-overflow: ellipsis; white-space: nowrap; }
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
@media (max-width: 600px) { .agent-dock:not(.agent-dock--office-overlay) { right: 14px; bottom: 14px; } }
@media (prefers-reduced-motion: reduce) { .agent-dock *, .agent-dock *::before, .agent-dock *::after { scroll-behavior: auto !important; transition-duration: 0s !important; } }
</style>
