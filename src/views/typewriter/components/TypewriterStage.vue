<template>
  <section
    ref="stageRef"
    class="tn-root tn-nocturne typewriter-stage"
    :class="stageClasses"
    :style="themeStyle"
    :aria-label="t('typewriter.ariaStage')"
  >
    <div class="tn-stage" ref="stageCanvasRef">
      <div class="tn-sheet" :style="sheetStyle">
        <div class="tn-text typewriter-terminal-host" :style="textStyle">
          <div ref="terminalRef" class="typewriter-terminal" :aria-label="t('typewriter.ariaTerminal')"></div>
          <div v-if="showCursor" class="typewriter-cursor" :style="cursorStyle" aria-hidden="true"></div>
        </div>
        <canvas ref="inkRef" class="tn-layer tn-ink" />
        <canvas ref="selectionRef" class="tn-layer tn-selection" />
        <canvas ref="paperRef" class="tn-layer tn-paper-light" />
        <canvas ref="glowRef" class="tn-layer tn-glow" />
      </div>
      <canvas ref="machineRef" class="tn-machine" :hidden="!machineVisible" />
      <div class="tn-vignette" aria-hidden="true"></div>
      <button class="tn-pull-cord" type="button" :aria-label="t('typewriter.lighting')" @click="toggleLamp">
        <span class="tn-pull-cord-line"></span>
        <span class="tn-pull-cord-tassel"></span>
      </button>
      <div class="typewriter-status" aria-live="polite">
        <span>{{ statusText }}</span>
        <span v-if="sessionId" class="typewriter-status-dot"></span>
      </div>
    </div>
  </section>
</template>

<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Terminal } from 'xterm'
import { CanvasAddon } from 'xterm-addon-canvas'
import { FitAddon } from 'xterm-addon-fit'
import { ImageAddon } from 'xterm-addon-image'
import { Unicode11Addon } from 'xterm-addon-unicode11'
import { WebglAddon } from 'xterm-addon-webgl'
import 'xterm/css/xterm.css'
import '@fontsource/ibm-plex-mono/400.css'
import '@fontsource/courier-prime/400.css'
import '@fontsource/eb-garamond/400.css'
import '@fontsource/cormorant-garamond/400.css'
import '@/features/typewriter/nocturne-core/nocturne.css'
import { activePaper, activeTheme, lightOn } from '@/features/typewriter/nocturne-core/app/nocturne/apply-config.ts'
import { stageLayout } from '@/features/typewriter/nocturne-core/app/nocturne/stage-layout.ts'
import { detectGpu, renderMode } from '@/features/typewriter/nocturne-core/lib/nocturne/lighting/gpu.ts'
import { StageController } from '@/features/typewriter/nocturne-core/lib/nocturne/stage-controller.ts'
import { themeVariables } from '@/features/typewriter/nocturne-core/lib/nocturne/theme-css.ts'
import { attachTypewriterTerminal } from '@/features/typewriter/bridge/terminal-bridge.js'
import { typewriterService } from '@/services/typewriter'

const props = defineProps({
  settings: { type: Object, required: true },
  startupCommand: { type: String, default: '' }
})
const emit = defineEmits(['state', 'session'])
const { t } = useI18n()

const stageRef = ref(null)
const stageCanvasRef = ref(null)
const terminalRef = ref(null)
const paperRef = ref(null)
const glowRef = ref(null)
const inkRef = ref(null)
const selectionRef = ref(null)
const machineRef = ref(null)
const size = ref({ width: 0, height: 0 })
const sessionId = ref('')
const terminalState = ref('starting')
const cursorFrame = ref(null)
const terminal = ref(null)
const fitAddon = ref(null)
const stageController = ref(null)
const bridge = ref(null)
let resizeObserver = null
let unlistenData = null
let unlistenExit = null

const theme = computed(() => activeTheme(props.settings))
const gpu = detectGpu()
const mode = computed(() => renderMode(props.settings.lighting.quality, gpu))
const machineVisible = computed(() => Boolean(theme.value && mode.value !== 'basic' && !props.settings.focusMode && props.settings.typewriter.carriage))
const layout = computed(() => size.value.width && size.value.height
  ? stageLayout(size.value.width, size.value.height, machineVisible.value, props.settings.paper.width)
  : null)
const themeStyle = computed(() => theme.value ? themeVariables(theme.value, props.settings) : {})
const stageClasses = computed(() => ({
  'tn-focus': props.settings.focusMode,
  'tn-no-light': !props.settings.effects || !lightOn(props.settings),
  'tn-no-ink': !props.settings.effects,
  'tn-quiet': !props.settings.effects || props.settings.focusMode,
  'tn-basic': mode.value === 'basic'
}))
const sheetStyle = computed(() => layout.value ? {
  left: `${layout.value.sheet.x}px`,
  top: `${layout.value.sheet.y}px`,
  width: `${layout.value.sheet.width}px`,
  height: `${layout.value.sheet.height}px`
} : {})
const textStyle = computed(() => layout.value ? {
  left: `${layout.value.text.x - layout.value.sheet.x}px`,
  top: `${layout.value.text.y - layout.value.sheet.y}px`,
  width: `${layout.value.text.width}px`,
  height: `${layout.value.text.height}px`
} : {})
const showCursor = computed(() => Boolean(cursorFrame.value?.visible && !cursorFrame.value?.cursorHidden))
const cursorStyle = computed(() => {
  const frame = cursorFrame.value
  if (!frame || !stageCanvasRef.value) return {}
  const rect = stageCanvasRef.value.getBoundingClientRect()
  return {
    left: `${frame.x - rect.left}px`,
    top: `${frame.y - rect.top}px`,
    width: `${frame.width}px`,
    height: `${frame.height}px`
  }
})
const statusText = computed(() => {
  if (terminalState.value === 'starting') return t('typewriter.terminalStarting')
  if (terminalState.value === 'offline') return t('typewriter.terminalOffline')
  if (terminalState.value === 'exited') return t('typewriter.terminalExited')
  if (terminalState.value === 'error') return t('typewriter.terminalFailed')
  return props.settings.focusMode ? t('typewriter.focusMode') : t('typewriter.workspace')
})

function refreshSize() {
  const el = stageCanvasRef.value
  if (!el) return
  const next = { width: el.clientWidth, height: el.clientHeight }
  if (next.width !== size.value.width || next.height !== size.value.height) size.value = next
}

async function createTerminal() {
  if (!window.electronAPI) {
    terminalState.value = 'offline'
    terminal.value?.write('\r\nTypewriter is available in the Happy Friday desktop app.\r\n')
    return
  }
  terminalState.value = 'starting'
  const result = await typewriterService.createTerminal({ cols: 120, rows: 36 })
  if (!result?.success || !result.sessionId) {
    terminalState.value = 'error'
    emit('state', 'error')
    return
  }
  sessionId.value = result.sessionId
  terminalState.value = 'ready'
  emit('session', result.sessionId)
  unlistenData = typewriterService.listenData(({ payload }) => {
    if (payload?.sessionId === sessionId.value) terminal.value?.write(payload.data || '')
  })
  unlistenExit = typewriterService.listenExit(({ payload }) => {
    if (payload?.sessionId !== sessionId.value) return
    terminalState.value = 'exited'
    emit('state', 'exited')
  })
  fitTerminal()
  if (props.startupCommand) {
    const command = `${props.startupCommand}${props.startupCommand.endsWith('\n') ? '' : '\r'}`
    typewriterService.writeTerminal(sessionId.value, command)
  }
}

function fitTerminal() {
  if (!fitAddon.value || !terminal.value || !sessionId.value) return
  try {
    fitAddon.value.fit()
    typewriterService.resizeTerminal(sessionId.value, terminal.value.cols, terminal.value.rows)
  } catch {}
}

function toggleLamp() {
  emit('toggle-light')
}

function setupStage() {
  if (!stageCanvasRef.value || !paperRef.value || !glowRef.value || !inkRef.value || !selectionRef.value || !machineRef.value) return
  stageController.value = new StageController({
    stage: stageCanvasRef.value,
    paper: paperRef.value,
    glow: glowRef.value,
    ink: inkRef.value,
    selection: selectionRef.value,
    machine: machineRef.value
  }, props.settings)
}

watch([layout, () => props.settings, mode], () => {
  if (layout.value) stageController.value?.update(props.settings, layout.value, mode.value)
  fitTerminal()
}, { deep: true })

watch(cursorFrame, frame => {
  if (frame) stageController.value?.invalidate()
})

onMounted(async () => {
  await nextTick()
  refreshSize()
  resizeObserver = new ResizeObserver(refreshSize)
  if (stageCanvasRef.value) resizeObserver.observe(stageCanvasRef.value)
  const xterm = new Terminal({
    allowProposedApi: true,
    cursorBlink: false,
    cursorStyle: 'bar',
    convertEol: true,
    fontFamily: '"Courier Prime", "IBM Plex Mono", ui-monospace, Consolas, monospace',
    fontSize: props.settings.typography.fontSize,
    lineHeight: props.settings.typography.lineHeight,
    theme: {
      background: activePaper(props.settings).paper,
      foreground: activePaper(props.settings).ink,
      cursor: 'transparent',
      selectionBackground: 'rgba(176, 138, 74, .22)'
    },
    scrollback: 5000
  })
  const fit = new FitAddon()
  xterm.loadAddon(fit)
  try { xterm.loadAddon(new CanvasAddon()) } catch {}
  if (props.settings.lighting.quality === 'high') {
    try { xterm.loadAddon(new WebglAddon()) } catch {}
  }
  try { xterm.loadAddon(new ImageAddon({ sixelSupport: true, iipSupport: true })) } catch {}
  try { xterm.loadAddon(new Unicode11Addon()); xterm.unicode.activeVersion = '11' } catch {}
  xterm.open(terminalRef.value)
  terminal.value = xterm
  fitAddon.value = fit
  setupStage()
  if (layout.value) stageController.value?.update(props.settings, layout.value, mode.value)
  bridge.value = attachTypewriterTerminal('typewriter-main', xterm)
  const { on } = await import('@/features/typewriter/nocturne-core/lib/nocturne/bus.ts')
  const stopCursor = on('cursor', frame => { cursorFrame.value = frame })
  bridge.value.disposeCursor = stopCursor
  await createTerminal()
  fitTerminal()
})

onUnmounted(() => {
  if (resizeObserver) resizeObserver.disconnect()
  unlistenData?.()
  unlistenExit?.()
  bridge.value?.disposeCursor?.()
  bridge.value?.dispose?.()
  if (sessionId.value) typewriterService.killTerminal(sessionId.value)
  stageController.value?.dispose?.()
  terminal.value?.dispose?.()
})
</script>

<style scoped>
.typewriter-stage { width:100%; height:100%; min-height:0; overflow:hidden; background:var(--tn-room,#241a14); color:var(--tn-ink,#2b231c); }
.typewriter-terminal-host { overflow:hidden; }
.typewriter-terminal { width:100%; height:100%; padding:0; outline:0; }
.typewriter-terminal :deep(.xterm) { width:100%; height:100%; padding:0; font-variant-ligatures:none; }
.typewriter-terminal :deep(.xterm-viewport) { background:transparent !important; scrollbar-width:none; }
.typewriter-terminal :deep(.xterm-viewport::-webkit-scrollbar) { display:none; }
.typewriter-terminal :deep(.xterm-screen) { padding:0; }
.typewriter-cursor { position:absolute; z-index:8; pointer-events:none; background:var(--tn-cursor,#3a2c20); opacity:.88; mix-blend-mode:multiply; animation:tn-cursor-breathe 2.4s ease-in-out infinite; }
.typewriter-status { position:absolute; left:22px; bottom:16px; z-index:20; display:flex; align-items:center; gap:7px; padding:5px 9px; border:1px solid color-mix(in srgb,var(--tn-accent,#b08a4a) 28%,transparent); border-radius:999px; color:var(--tn-ink-muted,#6e6153); background:color-mix(in srgb,var(--tn-paper,#f4ecdb) 82%,transparent); font:12px var(--tn-font-ui,Georgia,serif); pointer-events:none; }
.typewriter-status-dot { width:6px; height:6px; border-radius:50%; background:var(--tn-accent,#b08a4a); box-shadow:0 0 0 3px color-mix(in srgb,var(--tn-accent,#b08a4a) 18%,transparent); }
.tn-pull-cord { position:absolute; right:18px; top:10px; z-index:30; width:30px; height:150px; border:0; background:transparent; cursor:pointer; }
.tn-pull-cord-line { position:absolute; left:14px; top:0; width:2px; height:118px; background:linear-gradient(var(--tn-metal-hi,#f3dca4),var(--tn-metal-lo,#5e431c)); box-shadow:0 0 4px rgba(255,215,145,.35); }
.tn-pull-cord-tassel { position:absolute; left:7px; top:112px; width:16px; height:28px; border-radius:8px 8px 10px 10px; background:linear-gradient(90deg,var(--tn-ribbon,#8e2f25),var(--tn-accent,#b08a4a),var(--tn-ribbon,#8e2f25)); box-shadow:0 4px 8px rgba(0,0,0,.28); transition:transform .18s ease; }
.tn-pull-cord:active .tn-pull-cord-tassel { transform:translateY(7px); }
@keyframes tn-cursor-breathe { 0%,100%{ opacity:.62; transform:scaleY(.86); } 50%{ opacity:.92; transform:scaleY(1); } }
@media (prefers-reduced-motion: reduce) { .typewriter-cursor { animation:none; } }
</style>
