<template>
  <main class="typewriter-page">
    <template v-if="!started">
      <section class="typewriter-start">
        <div class="start-ornament" aria-hidden="true"><span></span><span></span><span></span></div>
        <img :src="iconUrl" class="start-icon" alt="" draggable="false" />
        <p class="eyebrow">{{ t('typewriter.title') }}</p>
        <h1>{{ t('typewriter.subtitle') }}</h1>
        <p class="start-description">{{ t('typewriter.description') }}</p>
        <div class="source-grid">
          <button class="source-card primary" type="button" @click="startTerminal">
            <span class="source-glyph">⌘</span>
            <strong>{{ t('typewriter.launchTerminal') }}</strong>
            <small>PowerShell · Bash · Zsh · Python · Node</small>
          </button>
          <button class="source-card" type="button" @click="startBlank">
            <span class="source-glyph">✎</span>
            <strong>{{ t('typewriter.newBlank') }}</strong>
            <small>Markdown · plain text · code</small>
          </button>
          <button class="source-card" type="button" @click="openTextFile">
            <span class="source-glyph">▤</span>
            <strong>{{ t('typewriter.openMarkdown') }}</strong>
            <small>.md · .txt · .js · .py · .json</small>
          </button>
        </div>
        <div class="start-footnote">{{ t('typewriter.recentEmpty') }}</div>
      </section>
    </template>

    <template v-else>
      <section class="typewriter-workspace">
        <header class="workspace-toolbar">
          <div class="toolbar-title">
            <img :src="iconUrl" alt="" draggable="false" />
            <span>{{ draftTitle || t('typewriter.workspace') }}</span>
            <span v-if="draftDirty" class="dirty-dot" :title="t('typewriter.unsaved')"></span>
          </div>
          <div class="toolbar-actions">
            <button class="toolbar-button" type="button" :aria-pressed="studioOpen" :title="t('typewriter.ariaStudio')" @click="studioOpen = !studioOpen">☷ <span>{{ t('typewriter.studio') }}</span></button>
            <button class="toolbar-button" type="button" @click="pressOpen = true">✦ <span>{{ t('typewriter.press') }}</span></button>
            <button class="toolbar-button" type="button" @click="archiveOpen = true">▤ <span>{{ t('typewriter.archive') }}</span></button>
            <button class="toolbar-button icon-only" type="button" :title="t('typewriter.close')" @click="closeWorkspace">×</button>
          </div>
        </header>
        <div class="workspace-body">
          <TypewriterStage :settings="store.settings" :startup-command="startupCommand" @toggle-light="toggleLight" @state="onStageState" />
          <aside v-if="studioOpen" class="studio-panel">
            <div class="panel-heading"><strong>{{ t('typewriter.studio') }}</strong><button type="button" @click="studioOpen = false">×</button></div>
            <label>{{ t('typewriter.theme') }}
              <select v-model="selectedTheme" @change="changeTheme">
                <option value="paper-and-ink">{{ t('typewriter.paperAndInk') }}</option>
                <option value="midnight-study">{{ t('typewriter.midnightStudy') }}</option>
                <option value="moonlit-poetry">{{ t('typewriter.moonlitPoetry') }}</option>
                <option value="classic">{{ t('typewriter.classic') }}</option>
              </select>
            </label>
            <label>{{ t('typewriter.paper') }}
              <select v-model="selectedPaper" @change="changePaper">
                <option value="onionskin">{{ t('typewriter.onionskin') }}</option>
                <option value="cotton">{{ t('typewriter.cotton') }}</option>
                <option value="laid">{{ t('typewriter.laid') }}</option>
                <option value="linen">{{ t('typewriter.linen') }}</option>
                <option value="parchment">{{ t('typewriter.parchment') }}</option>
                <option value="night">{{ t('typewriter.night') }}</option>
              </select>
            </label>
            <label class="toggle-row"><span>{{ t('typewriter.effects') }}</span><input v-model="effectsEnabled" type="checkbox" @change="toggleEffects" /></label>
            <label class="toggle-row"><span>{{ t('typewriter.sound') }}</span><input v-model="soundEnabled" type="checkbox" @change="toggleSound" /></label>
            <label class="toggle-row"><span>{{ t('typewriter.focusMode') }}</span><input v-model="focusEnabled" type="checkbox" @change="toggleFocus" /></label>
            <label>{{ t('typewriter.quality') }}
              <select v-model="quality" @change="changeQuality"><option value="auto">Auto</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select>
            </label>
            <p class="panel-note">{{ stageStatus }}</p>
          </aside>
        </div>
      </section>
      <div v-if="pressOpen || archiveOpen" class="dialog-backdrop" @click.self="pressOpen = archiveOpen = false">
        <section class="typewriter-dialog">
          <div class="panel-heading"><strong>{{ pressOpen ? t('typewriter.pressTitle') : t('typewriter.archiveTitle') }}</strong><button type="button" @click="pressOpen = archiveOpen = false">×</button></div>
          <template v-if="pressOpen">
            <textarea v-model="folioText" class="folio-input" :placeholder="t('typewriter.pressTitle')"></textarea>
            <div class="dialog-actions"><button type="button" @click="copyFolio">{{ t('typewriter.copy') }}</button><button type="button" @click="saveFolio">{{ t('typewriter.save') }}</button></div>
          </template>
          <template v-else>
            <p class="archive-empty">{{ t('typewriter.noArchive') }}</p>
          </template>
        </section>
      </div>
    </template>
  </main>
</template>

<script setup>
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useTypewriterStore } from '@/store'
import { typewriterService } from '@/services/typewriter'
import TypewriterStage from './components/TypewriterStage.vue'

const { t } = useI18n()
const store = useTypewriterStore()
const iconUrl = new URL('../../features/typewriter/nocturne-core/icon.svg', import.meta.url).href
const started = ref(false)
const studioOpen = ref(false)
const pressOpen = ref(false)
const archiveOpen = ref(false)
const stageStatus = ref('')
const startupCommand = ref('')
const folioText = ref('')
const selectedTheme = ref(store.settings.theme)
const selectedPaper = ref(store.settings.paper.style)
const effectsEnabled = ref(store.settings.effects)
const soundEnabled = ref(store.settings.typewriter.sound)
const focusEnabled = ref(store.settings.focusMode)
const quality = ref(store.settings.lighting.quality)
const draftTitle = computed(() => store.draft.title)
const draftDirty = computed(() => store.draft.dirty)

function startTerminal() {
  store.setDraft({ id: 'terminal', type: 'terminal', title: t('typewriter.terminal'), path: '', dirty: false })
  startupCommand.value = ''
  started.value = true
}

function startBlank() {
  store.setDraft({ id: 'blank', type: 'blank', title: t('typewriter.newBlank'), path: '', content: '', dirty: false })
  startupCommand.value = ''
  started.value = true
}

async function openTextFile() {
  const filePath = await typewriterService.openFile({
    properties: ['openFile'],
    filters: [{ name: 'Text and code', extensions: ['md', 'markdown', 'txt', 'js', 'mjs', 'cjs', 'json', 'py', 'css', 'html', 'vue'] }]
  })
  if (!filePath) return
  const result = await typewriterService.readFile(filePath)
  if (!result?.success) return
  const name = filePath.split(/[\\/]/).pop() || t('typewriter.openMarkdown')
  store.setDraft({ id: filePath, type: 'file', title: name, path: filePath, content: result.content || '', dirty: false })
  store.setSource({ type: 'file', title: name, path: filePath })
  const escaped = String(filePath).replace(/'/g, "''")
  startupCommand.value = window.electronAPI?.platform === 'win32'
    ? `Get-Content -Raw -LiteralPath '${escaped}'`
    : `cat -- '${escaped.replace(/'/g, "'\\''")}'`
  started.value = true
}

function closeWorkspace() {
  started.value = false
  startupCommand.value = ''
  studioOpen.value = false
  pressOpen.value = false
  archiveOpen.value = false
}

function toggleLight() {
  store.patchSettings({ lighting: { enabled: !store.settings.lighting.enabled } })
}
function changeTheme() { store.patchSettings({ theme: selectedTheme.value }) }
function changePaper() { store.patchSettings({ paper: { style: selectedPaper.value } }) }
function toggleEffects() { store.patchSettings({ effects: effectsEnabled.value }) }
function toggleSound() { store.patchSettings({ typewriter: { sound: soundEnabled.value } }) }
function toggleFocus() { store.patchSettings({ focusMode: focusEnabled.value }) }
function changeQuality() { store.patchSettings({ lighting: { quality: quality.value } }) }
function onStageState(state) { stageStatus.value = state === 'ready' ? '' : state }

async function copyFolio() {
  if (!folioText.value.trim()) return
  await navigator.clipboard?.writeText(folioText.value)
}
function saveFolio() {
  const text = folioText.value.trim()
  if (!text) return
  const archive = JSON.parse(localStorage.getItem('happy-friday-typewriter-archive') || '[]')
  archive.unshift({ id: crypto.randomUUID(), text, createdAt: new Date().toISOString() })
  localStorage.setItem('happy-friday-typewriter-archive', JSON.stringify(archive.slice(0, 50)))
  pressOpen.value = false
}
</script>

<style scoped>
.typewriter-page{width:100%;height:100%;min-height:0;background:#17110d;color:#f4ecdb;overflow:hidden}.typewriter-start{position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;width:100%;height:100%;padding:48px;box-sizing:border-box;background:radial-gradient(circle at 50% 28%,rgba(179,137,75,.14),transparent 38%),linear-gradient(145deg,#241a14,#0c0806);text-align:center}.start-icon{width:92px;height:92px;filter:drop-shadow(0 18px 24px rgba(0,0,0,.34));margin-bottom:22px}.eyebrow{margin:0 0 10px;color:#d9c08a;font:600 12px/1.2 ui-monospace,monospace;letter-spacing:.18em;text-transform:uppercase}.typewriter-start h1{max-width:680px;margin:0;color:#f4ecdb;font:500 clamp(25px,4vw,44px)/1.08 "EB Garamond",Georgia,serif}.start-description{max-width:520px;margin:16px 0 28px;color:#b7a897;font-size:14px;line-height:1.7}.source-grid{display:grid;grid-template-columns:repeat(3,minmax(160px,1fr));gap:12px;width:min(780px,100%)}.source-card{display:flex;flex-direction:column;align-items:flex-start;gap:8px;padding:18px;border:1px solid rgba(217,192,138,.22);border-radius:10px;background:rgba(244,236,219,.06);color:#f4ecdb;text-align:left;cursor:pointer;transition:transform .18s ease,border-color .18s ease,background .18s ease}.source-card:hover{transform:translateY(-3px);border-color:#d9c08a;background:rgba(244,236,219,.12)}.source-card.primary{background:linear-gradient(145deg,rgba(176,138,74,.28),rgba(80,46,25,.18));border-color:rgba(217,192,138,.48)}.source-glyph{font-size:25px;color:#d9c08a}.source-card strong{font-size:14px}.source-card small{color:#b7a897;font-size:11px;line-height:1.4}.start-footnote{margin-top:26px;color:#7d7060;font:12px ui-monospace,monospace}.start-ornament{position:absolute;top:24px;display:flex;gap:8px}.start-ornament span{display:block;width:4px;height:4px;border-radius:50%;background:#b08a4a;opacity:.7}.typewriter-workspace{display:flex;flex-direction:column;width:100%;height:100%;min-height:0}.workspace-toolbar{display:flex;align-items:center;justify-content:space-between;gap:12px;height:48px;padding:0 14px 0 18px;background:#18110d;border-bottom:1px solid rgba(217,192,138,.14);color:#f4ecdb}.toolbar-title,.toolbar-actions{display:flex;align-items:center;gap:9px;min-width:0}.toolbar-title img{width:25px;height:25px}.toolbar-title span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:14px "EB Garamond",Georgia,serif}.dirty-dot{width:6px;height:6px;border-radius:50%;background:#c97858}.toolbar-button{display:inline-flex;align-items:center;gap:5px;padding:6px 8px;border:1px solid transparent;border-radius:6px;background:transparent;color:#b7a897;font:12px ui-monospace,monospace;cursor:pointer}.toolbar-button:hover,.toolbar-button[aria-pressed="true"]{border-color:rgba(217,192,138,.28);background:rgba(244,236,219,.08);color:#f4ecdb}.toolbar-button.icon-only{font-size:20px;line-height:1}.workspace-body{position:relative;display:flex;flex:1;min-height:0}.workspace-body>.typewriter-stage{flex:1}.studio-panel{position:absolute;z-index:50;top:12px;right:14px;width:260px;padding:14px;border:1px solid rgba(217,192,138,.3);border-radius:10px;background:rgba(33,23,17,.96);box-shadow:0 20px 50px rgba(0,0,0,.34);color:#f4ecdb}.panel-heading{display:flex;align-items:center;justify-content:space-between;margin-bottom:13px;color:#f4ecdb}.panel-heading button{border:0;background:transparent;color:#b7a897;font-size:19px;cursor:pointer}.studio-panel label{display:flex;flex-direction:column;gap:6px;margin:12px 0;color:#b7a897;font:12px ui-monospace,monospace}.studio-panel select,.folio-input{padding:8px;border:1px solid rgba(217,192,138,.24);border-radius:6px;background:#1b130e;color:#f4ecdb;font:12px ui-monospace,monospace}.toggle-row{flex-direction:row!important;align-items:center;justify-content:space-between}.toggle-row input{accent-color:#b08a4a}.panel-note{margin:14px 0 0;color:#7d7060;font-size:11px;line-height:1.5}.dialog-backdrop{position:fixed;inset:0;z-index:100;display:flex;align-items:center;justify-content:center;padding:20px;background:rgba(0,0,0,.55)}.typewriter-dialog{width:min(560px,100%);padding:18px;border:1px solid rgba(217,192,138,.35);border-radius:12px;background:#211710;color:#f4ecdb;box-shadow:0 24px 70px rgba(0,0,0,.45)}.folio-input{display:block;width:100%;min-height:240px;box-sizing:border-box;resize:vertical;line-height:1.6}.dialog-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:12px}.dialog-actions button{padding:8px 12px;border:1px solid rgba(217,192,138,.32);border-radius:6px;background:rgba(244,236,219,.08);color:#f4ecdb;cursor:pointer}.archive-empty{margin:24px 0;color:#b7a897;text-align:center}@media(max-width:720px){.typewriter-start{padding:28px 18px}.source-grid{grid-template-columns:1fr}.toolbar-button span{display:none}.studio-panel{left:12px;right:12px;width:auto}}
</style>
