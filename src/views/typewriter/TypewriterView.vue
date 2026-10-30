<template>
  <main class="typewriter-page" :style="chromeStyle">
    <section v-if="!started" class="typewriter-start">
      <img :src="iconUrl" class="start-icon" alt="" />
      <p class="eyebrow">Typewriter Nocturne</p>
      <h1>{{ t('typewriter.subtitle') }}</h1>
      <p class="start-description">{{ t('typewriter.description') }}</p>
      <div class="source-grid">
        <button class="source-card primary" data-action="new-note" @click="newNote"><span class="source-glyph">✎</span><strong>{{ t('typewriter.newNote') }}</strong><small>{{ t('typewriter.noteLinked') }}</small></button>
        <button class="source-card" data-action="choose-note" @click="chooseNote"><span class="source-glyph">▤</span><strong>{{ t('typewriter.openNote') }}</strong><small>{{ t('typewriter.noteLinked') }}</small></button>
        <button class="source-card" data-action="open-file" @click="openTextFile"><span class="source-glyph">↗</span><strong>{{ t('typewriter.importFile') }}</strong><small>Markdown · .txt · .js · .py</small></button>
        <button class="source-card" data-action="terminal" @click="startTerminal"><span class="source-glyph">⌘</span><strong>{{ t('typewriter.launchTerminal') }}</strong><small>PowerShell · Bash · Zsh</small></button>
      </div>
      <p v-if="error" class="error" role="alert">{{ error }}</p>
    </section>
    <section v-else class="typewriter-workspace">
      <header class="workspace-toolbar">
        <div class="toolbar-title"><img :src="iconUrl" alt="" /><span>{{ source?.title || t('typewriter.terminal') }}</span><small role="status" data-save-status>{{ source ? t('typewriter.' + saveStatus) : '' }}</small></div>
        <div class="toolbar-actions">
          <button class="toolbar-button" data-action="choose-note" @click="chooseNote">{{ t('typewriter.openNote') }}</button>
          <button class="toolbar-button" data-action="new-note" @click="newNote">{{ t('typewriter.newNote') }}</button>
          <button class="toolbar-button" data-action="terminal" @click="startTerminal">{{ t('typewriter.terminal') }}</button>
          <button v-if="source" class="toolbar-button" data-action="open-note-page" @click="openNotePage">{{ t('typewriter.openInNotes') }}</button>
          <button v-if="source" class="toolbar-button" @click="showLinks=!showLinks">{{ t('workspace.links.title') }}</button>
          <button v-if="source" class="toolbar-button" :aria-pressed="showPreview" @click="togglePreview">{{ showPreview ? t('typewriter.backToEdit') : t('typewriter.preview') }}</button>
          <button v-if="source" class="toolbar-button" @click="exportText">{{ t('typewriter.exportMarkdown') }}</button>
          <button v-if="source" class="toolbar-button" data-action="insert-image" @click="imageInput?.click()">{{ t('typewriter.insertImage') }}</button>
          <input ref="imageInput" class="typewriter-image-input" type="file" accept="image/*" @change="insertImageFile" />
          <select class="language-select" :aria-label="t('typewriter.language')" :value="appStore.language" @change="changeLanguage($event.target.value)"><option value="zh-CN">中文</option><option value="en-US">English</option></select>
          <button class="toolbar-button icon-only" :title="t('typewriter.close')" @click="closeWorkspace">×</button>
        </div>
      </header>
      <div v-if="source && imageSources.length && !showPreview" class="typewriter-image-strip" :aria-label="t('typewriter.images')">
        <span class="typewriter-image-label">{{ t('typewriter.images') }}</span>
        <figure v-for="image in imageSources" :key="image.key" class="typewriter-image-card">
          <img v-if="!image.failed" :src="image.displaySrc || image.src" :alt="image.alt || t('typewriter.image')" decoding="async" @load="markImageLoaded(image)" @error="markImageFailed(image)" />
          <button v-else class="typewriter-image-failed" type="button" @click="retryImage(image)">{{ t('typewriter.imageFailed') }}</button>
          <figcaption>{{ image.alt || t('typewriter.image') }}</figcaption>
        </figure>
      </div>
      <p v-if="error" class="workspace-error" role="alert">{{ error }}</p>
      <div class="workspace-body" :class="{ 'is-preview': showPreview }" @paste="handleImagePaste" @dragover="handleImageDragOver" @drop="handleImageDrop"><TypewriterStage ref="stage" v-show="!showPreview" :settings="store.settings" :source="source" @settings="store.patchSettings" @change="handleSourceChange" /><article v-if="source && showPreview" class="typewriter-preview" :style="previewStyle" role="region" :aria-label="t('typewriter.preview')" v-html="previewHtml" /><NoteLinksPanel v-if="source && showLinks" :note-id="source.noteId" :initial-mode="linksMode" @close="showLinks=false" @open="openLinkLocation" /></div>
    </section>
    <div v-if="picking" class="dialog-backdrop" @click.self="picking = false">
      <section class="typewriter-dialog note-picker" role="dialog" :aria-label="t('typewriter.openNote')">
        <div class="panel-heading"><strong>{{ t('typewriter.openNote') }}</strong><button :aria-label="t('typewriter.close')" @click="picking = false">×</button></div>
        <input v-model="query" class="tn-search" :aria-label="t('typewriter.searchNotes')" :placeholder="t('typewriter.searchNotes')" />
        <div class="note-choices"><button v-for="note in visibleNotes" :key="note.id" :data-note-id="note.id" @click="selectNote(note.id)"><strong>{{ note.title }}</strong><small>{{ note.contentText?.slice(0, 90) }}</small></button></div>
        <p v-if="!visibleNotes.length">{{ t('typewriter.noNotes') }}</p>
        <button class="toolbar-button" @click="newNote">{{ t('typewriter.newNote') }}</button>
      </section>
    </div>
  </main>
</template>
<script setup>
import { computed, nextTick, onActivated, onBeforeUnmount, shallowRef, ref } from 'vue'
import { onBeforeRouteLeave, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useTypewriterStore, useNoteStore, useAppStore } from '@/store'
import { typewriterService } from '@/services/typewriter'
import { electronService } from '@/services/electron'
import {readNote,subscribeNotes} from '@/features/notes/documents'
import { setI18nLanguage } from '@/i18n'
import { createNoteDocument, markdownToNote } from '@/features/typewriter/adapters/note-adapter'
import { insertContent } from '@/features/typewriter/content-plugin'
import { extractTypewriterImages, markdownImage } from '@/features/typewriter/image-utils'
import { activePaper, activeTheme } from '@/features/typewriter/nocturne-core/app/nocturne/apply-config.ts'
import { fontStack } from '@/features/typewriter/nocturne-core/app/nocturne/settings.ts'
import { THEMES } from '@/features/typewriter/nocturne-core/app/nocturne/themes.ts'
import { themeVariables } from '@/features/typewriter/nocturne-core/lib/nocturne/theme-css.ts'
import NoteLinksPanel from '@/components/notes/NoteLinksPanel.vue'
import {resolveNoteTarget} from '@/features/notes/link-target'
import {requestNoteLocation} from '@/features/notes/location'
import TypewriterStage from './components/TypewriterStage.vue'
const { t } = useI18n()
const router = useRouter(), store = useTypewriterStore(), notes = useNoteStore(), appStore = useAppStore()
const iconUrl = new URL('../../features/typewriter/nocturne-core/icon.svg', import.meta.url).href
const started = ref(false), picking = ref(false), query = ref(''), error = ref(''), saveStatus = ref('saved')
const linksMode=ref('outgoing'); const showLinks=ref(false)
function handleLinks(event){linksMode.value=event.detail||'outgoing';if(router.currentRoute.value.path.startsWith('/typewriter'))showLinks.value=true}
function handleAction(event){if(router.currentRoute.value.path.startsWith('/typewriter')&&event.detail==='terminal')void startTerminal()}
window.addEventListener('friday:show-links',handleLinks)
window.addEventListener('friday:typewriter-action',handleAction)
onBeforeUnmount(()=>{window.removeEventListener('friday:show-links',handleLinks);window.removeEventListener('friday:typewriter-action',handleAction)})
const source = shallowRef(null), stage = ref(null), imageInput = ref(null), imageRevision = ref(0), failedImageSources = ref(new Set()), fallbackImageSources = ref(new Map()), showPreview = ref(false)
let imageRefreshTimer = 0
const imageFallbackFiles = new Map()
const unlistenNotes=subscribeNotes(async event=>{if(event.noteId!==source.value?.noteId)return;const document=source.value;try{const note=await readNote(event.noteId);if(source.value===document&&note){document.refresh(note);refreshImageSourcesSoon(true)}}catch{error.value=t('typewriter.operationFailed')}})
onBeforeUnmount(()=>unlistenNotes())
const chromeStyle = computed(() => themeVariables(activeTheme(store.settings) || THEMES['paper-and-ink'], store.settings))
const visibleNotes = computed(() => notes.notes.filter(note => !note.isDeleted && (note.title + ' ' + (note.contentText || '')).toLowerCase().includes(query.value.toLowerCase())))
const imageSources = computed(() => {
  // 图片扫描不参与每次按键的同步路径，保留当前列表直到空闲刷新。
  void imageRevision.value
  return extractTypewriterImages(source.value?.content || '').map(image => ({
    ...image,
    displaySrc: fallbackImageSources.value.get(image.src) || image.src,
    failed: failedImageSources.value.has(image.src)
  }))
})
const previewStyle = computed(() => {
  const typography = store.settings.typography
  const paper = activePaper(store.settings)
  return {fontFamily: fontStack(typography), fontSize: `${typography.fontSize}px`, fontWeight: typography.fontWeight,
    lineHeight: `${typography.fontSize * typography.lineHeight}px`, letterSpacing: `${typography.letterSpacing}px`, color: paper.ink}
})
const previewHtml = computed(() => {
  void imageRevision.value
  const parsed = new DOMParser().parseFromString(markdownToNote(source.value?.content || '').content, 'text/html')
  parsed.querySelectorAll('svg,math,form,input,button,video,audio,canvas,source,track').forEach(node => node.remove())
  parsed.querySelectorAll('*').forEach(node => {
    for (const attr of [...node.attributes]) {
      const name = attr.name.toLowerCase(), value = attr.value.trim()
      if (name.startsWith('on') || ['style', 'srcset', 'srcdoc', 'contenteditable', 'autofocus'].includes(name)) { node.removeAttribute(attr.name); continue }
      if (name === 'src' && !/^(data:image\/(?:png|jpe?g|gif|webp|bmp|svg\+xml);|file:\/\/|blob:|friday-asset:\/\/|https?:\/\/)/i.test(value)) node.removeAttribute(attr.name)
      if (name === 'href' && !/^(https?:\/\/|mailto:|friday:|#)/i.test(value)) node.removeAttribute(attr.name)
    }
  })
  return parsed.body.innerHTML
})
function refreshImageSourcesSoon(immediate = false) {
  if (imageRefreshTimer) window.clearTimeout(imageRefreshTimer)
  if (immediate) { imageRevision.value++; return }
  imageRefreshTimer = window.setTimeout(() => { imageRefreshTimer = 0; imageRevision.value++ }, 180)
}
function handleSourceChange(next) { source.value?.change(next); refreshImageSourcesSoon() }
async function togglePreview() {
  showPreview.value = !showPreview.value
  if (showPreview.value) stage.value?.blur()
  else { await nextTick(); stage.value?.focus() }
}
function imageFilePath(file) {
  try { return window.electronAPI?.getPathForFile?.(file) || file?.path || '' } catch { return file?.path || '' }
}
function imageAltForFile(file) {
  return String(file?.name || '').replace(/\.[^.]+$/, '').replace(/[\[\]]/g, '').trim() || t('typewriter.image')
}
function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error('IMAGE_READ_FAILED'))
    reader.readAsDataURL(file)
  })
}
async function insertImageFileValue(file) {
  if (!file || !source.value) return false
  const targetDocument = source.value
  const mime = String(file.type || '').toLowerCase()
  if (mime && !mime.startsWith('image/')) return false
  if (Number(file.size) > 64 * 1024 * 1024) { error.value = t('typewriter.imageTooLarge'); return false }
  error.value = ''
  const alt = imageAltForFile(file)
  let src = ''
  const filePath = imageFilePath(file)
  if (filePath && source.value.noteId) {
    try {
      const asset = await electronService.invoke('note-resource-import', { noteId: targetDocument.noteId, filePath })
      if (asset?.ok) {
        // Keep the Markdown small even for ordinary screenshots. The managed
        // file URL survives save/reopen and avoids copying megabytes into the
        // draft journal on every keystroke. A data URL remains the fallback
        // for environments that cannot expose the managed file URL.
        src = asset.url || asset.dataUrl || ''
      }
    } catch { /* fall back to the in-memory file below */ }
  }
  // 小图优先使用 data URL；大图沿用托管资源 URL，避免把几十 MB 图片展开成超长 Markdown。
  if (!src) {
    try { src = await readFileAsDataUrl(file) } catch { error.value = t('typewriter.imageFailed'); return false }
  }
  if (!/^((data:image\/)|(file:\/\/)|(blob:)|(friday-asset:\/\/)|(https?:\/\/))/i.test(src)) {
    error.value = t('typewriter.imageFailed')
    return false
  }
  if (source.value !== targetDocument) return false
  if (/^file:\/\//i.test(src)) imageFallbackFiles.set(src, file)
  insertContent(markdownImage(alt, src))
  refreshImageSourcesSoon(true)
  return true
}
async function insertImageFile(event) {
  const file = event.target?.files?.[0]
  event.target.value = ''
  await insertImageFileValue(file)
}
async function handleImagePaste(event) {
  const files = Array.from(event.clipboardData?.files || []).filter(file => String(file.type || '').startsWith('image/'))
  if (!files.length) return
  event.preventDefault()
  await insertImageFileValue(files[0])
}
function handleImageDragOver(event) {
  const files = Array.from(event.dataTransfer?.files || [])
  if (files.some(file => String(file.type || '').startsWith('image/'))) event.preventDefault()
}
async function handleImageDrop(event) {
  const files = Array.from(event.dataTransfer?.files || []).filter(file => String(file.type || '').startsWith('image/'))
  if (!files.length) return
  event.preventDefault()
  await insertImageFileValue(files[0])
}
async function markImageFailed(image) {
  if (!image) return
  const file = imageFallbackFiles.get(image.src)
  if (file) {
    imageFallbackFiles.delete(image.src)
    try {
      const dataUrl = await readFileAsDataUrl(file)
      fallbackImageSources.value = new Map([...fallbackImageSources.value, [image.src, dataUrl]])
      return
    } catch { /* 显示可重试状态 */ }
  }
  failedImageSources.value = new Set([...failedImageSources.value, image.src])
}
function markImageLoaded(image) {
  if (image && image.displaySrc === image.src) imageFallbackFiles.delete(image.src)
}
function retryImage(image) {
  if (!image) return
  const failed = new Set(failedImageSources.value)
  failed.delete(image.src)
  failedImageSources.value = failed
  const fallback = new Map(fallbackImageSources.value)
  fallback.delete(image.src)
  fallbackImageSources.value = fallback
  refreshImageSourcesSoon(true)
}
async function guarded(action) {
  error.value = ''
  try { await source.value?.flush(); await notes.flushPendingSave(); await action() }
  catch { error.value = t('typewriter.operationFailed') }
}
function loadNote(note, initialSource) {
  source.value = createNoteDocument(notes, note, status => { saveStatus.value = status }, initialSource)
  imageFallbackFiles.clear()
  failedImageSources.value = new Set()
  fallbackImageSources.value = new Map()
  notes.selectNote(note.id); saveStatus.value = 'saved'; started.value = true; picking.value = false
}
async function newNote() { await guarded(async () => { const note = await notes.createNote(null, t('typewriter.untitled')); if (!note?.id) throw new Error('CREATE_FAILED'); loadNote(note, '') }) }
async function chooseNote() { await guarded(async () => { await notes.fetchNotes(); picking.value = true }) }
async function selectNote(id) { await guarded(async () => { const note = await notes.fetchNote(id); if (!note) throw new Error('NOTE_NOT_FOUND'); loadNote(note) }) }
async function openLinkLocation(location) { requestNoteLocation(location,'typewriter'); await selectNote(location.noteId) }
const openTextLink=async event=>{
  if(!router.currentRoute.value.path.startsWith('/typewriter'))return
  try { await openLinkLocation(await resolveNoteTarget(event.detail)) }
  catch { showLinks.value=true;linksMode.value='unresolved';error.value=t('workspace.links.resolveError') }
}
window.addEventListener('friday:open-note-link',openTextLink)
onBeforeUnmount(()=>window.removeEventListener('friday:open-note-link',openTextLink))
async function startTerminal() { await guarded(async () => { source.value = null; started.value = true; picking.value = false }) }
async function closeWorkspace() { await guarded(async () => { source.value = null; started.value = false }) }
async function openNotePage() { await guarded(async () => { notes.selectNote(source.value.noteId); await router.push({name:'note'}) }) }
async function openTextFile() {
  await guarded(async () => {
    const filePath = await typewriterService.openFile({properties:['openFile'], filters:[{name:t('typewriter.textFiles'),extensions:['md','markdown','txt','js','mjs','py','json','css','html','vue','ts','sh','ps1']}]})
    if (!filePath) return
    const result = await typewriterService.readFile(filePath)
    if (!result?.success) throw new Error('READ_FAILED')
    const title = filePath.split(/[\\/]/).pop()
    let text = result.content || ''
    if (!/\.(md|markdown|txt)$/i.test(filePath)) {
      const fence = '`'.repeat(Math.max(3, ...[...text.matchAll(/`+/g)].map(match => match[0].length + 1)))
      text = fence + '\n' + text + '\n' + fence
    }
    const content = markdownToNote(text)
    const note = await notes.importNote(null, null, title, content.content, content.contentText)
    if (!note?.id) throw new Error('IMPORT_FAILED')
    store.setSource({type:'note', title, path:filePath, noteId:note.id})
    loadNote(note, text)
  })
}
async function exportText() {
  await guarded(async () => {
    const file = await typewriterService.saveDialog({defaultPath:source.value.title + '.md', filters:[{name:'Markdown',extensions:['md']}]})
    if (!file) return
    const { contentText } = await import('@/features/typewriter/content-plugin')
    const result = await typewriterService.saveFile(typeof file === 'string' ? file : file.filePath, contentText('screen'))
    if (!result?.success) throw new Error('EXPORT_FAILED')
  })
}
async function changeLanguage(value) {
  appStore.setLanguage(value)
  setI18nLanguage(value)
  const config = await electronService.invoke('get-config')
  if (config) await electronService.invoke('save-config', {...config, language:value})
}
onBeforeRouteLeave(async () => { try { await source.value?.flush(); return true } catch { error.value = t('typewriter.saveFailed'); return false } })
onActivated(async () => {
  if (!source.value?.noteId) return
  const note = await notes.fetchNote(source.value.noteId)
  if (!note) return
  // Keep the mounted Nocturne/React surface across a cached route switch.
  // The fetch still verifies the same note and revision, while avoiding a
  // second WebGL/textarea mount when nothing changed in the background.
  if (source.value && Number(source.value.revision || 0) === Number(note.revision || 0)) {
    refreshImageSourcesSoon(true)
    return
  }
  loadNote(note)
})
onBeforeUnmount(() => { if (imageRefreshTimer) window.clearTimeout(imageRefreshTimer); imageFallbackFiles.clear(); void source.value?.flush().catch(() => {}) })
</script>
<style scoped>
.typewriter-page{width:100%;height:100%;min-height:0;background:#17110d;color:#f4ecdb;overflow:hidden}.typewriter-start{position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;width:100%;height:100%;padding:48px;box-sizing:border-box;background:radial-gradient(circle at 50% 28%,rgba(179,137,75,.14),transparent 38%),linear-gradient(145deg,#241a14,#0c0806);text-align:center}.start-icon{width:92px;height:92px;filter:drop-shadow(0 18px 24px rgba(0,0,0,.34));margin-bottom:22px}.eyebrow{margin:0 0 10px;color:#d9c08a;font:600 12px/1.2 ui-monospace,monospace;letter-spacing:.18em;text-transform:uppercase}.typewriter-start h1{max-width:680px;margin:0;color:#f4ecdb;font:500 clamp(25px,4vw,44px)/1.08 "EB Garamond",Georgia,serif}.start-description{max-width:520px;margin:16px 0 28px;color:#b7a897;font-size:14px;line-height:1.7}.source-grid{display:grid;grid-template-columns:repeat(3,minmax(160px,1fr));gap:12px;width:min(780px,100%)}.source-card{display:flex;flex-direction:column;align-items:flex-start;gap:8px;padding:18px;border:1px solid rgba(217,192,138,.22);border-radius:10px;background:rgba(244,236,219,.06);color:#f4ecdb;text-align:left;cursor:pointer;transition:transform .18s ease,border-color .18s ease,background .18s ease}.source-card:hover{transform:translateY(-3px);border-color:#d9c08a;background:rgba(244,236,219,.12)}.source-card.primary{background:linear-gradient(145deg,rgba(176,138,74,.28),rgba(80,46,25,.18));border-color:rgba(217,192,138,.48)}.source-glyph{font-size:25px;color:#d9c08a}.source-card strong{font-size:14px}.source-card small{color:#b7a897;font-size:11px;line-height:1.4}.start-footnote{margin-top:26px;color:#7d7060;font:12px ui-monospace,monospace}.start-ornament{position:absolute;top:24px;display:flex;gap:8px}.start-ornament span{display:block;width:4px;height:4px;border-radius:50%;background:#b08a4a;opacity:.7}.typewriter-workspace{display:flex;flex-direction:column;width:100%;height:100%;min-height:0}.workspace-toolbar{display:flex;align-items:center;justify-content:space-between;gap:12px;height:48px;padding:0 14px 0 18px;background:#18110d;border-bottom:1px solid rgba(217,192,138,.14);color:#f4ecdb}.toolbar-title,.toolbar-actions{display:flex;align-items:center;gap:9px;min-width:0}.toolbar-title img{width:25px;height:25px}.toolbar-title span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:14px "EB Garamond",Georgia,serif}.dirty-dot{width:6px;height:6px;border-radius:50%;background:#c97858}.toolbar-button{display:inline-flex;align-items:center;gap:5px;padding:6px 8px;border:1px solid transparent;border-radius:6px;background:transparent;color:#b7a897;font:12px ui-monospace,monospace;cursor:pointer}.toolbar-button:hover,.toolbar-button[aria-pressed="true"]{border-color:rgba(217,192,138,.28);background:rgba(244,236,219,.08);color:#f4ecdb}.toolbar-button.icon-only{font-size:20px;line-height:1}.workspace-body{position:relative;display:flex;flex:1;min-height:0}.workspace-body>.typewriter-stage{flex:1}.studio-panel{position:absolute;z-index:50;top:12px;right:14px;width:260px;padding:14px;border:1px solid rgba(217,192,138,.3);border-radius:10px;background:rgba(33,23,17,.96);box-shadow:0 20px 50px rgba(0,0,0,.34);color:#f4ecdb}.panel-heading{display:flex;align-items:center;justify-content:space-between;margin-bottom:13px;color:#f4ecdb}.panel-heading button{border:0;background:transparent;color:#b7a897;font-size:19px;cursor:pointer}.studio-panel label{display:flex;flex-direction:column;gap:6px;margin:12px 0;color:#b7a897;font:12px ui-monospace,monospace}.studio-panel select,.folio-input{padding:8px;border:1px solid rgba(217,192,138,.24);border-radius:6px;background:#1b130e;color:#f4ecdb;font:12px ui-monospace,monospace}.toggle-row{flex-direction:row!important;align-items:center;justify-content:space-between}.toggle-row input{accent-color:#b08a4a}.panel-note{margin:14px 0 0;color:#7d7060;font-size:11px;line-height:1.5}.dialog-backdrop{position:fixed;inset:0;z-index:100;display:flex;align-items:center;justify-content:center;padding:20px;background:rgba(0,0,0,.55)}.typewriter-dialog{width:min(560px,100%);padding:18px;border:1px solid rgba(217,192,138,.35);border-radius:12px;background:#211710;color:#f4ecdb;box-shadow:0 24px 70px rgba(0,0,0,.45)}.folio-input{display:block;width:100%;min-height:240px;box-sizing:border-box;resize:vertical;line-height:1.6}.dialog-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:12px}.dialog-actions button{padding:8px 12px;border:1px solid rgba(217,192,138,.32);border-radius:6px;background:rgba(244,236,219,.08);color:#f4ecdb;cursor:pointer}.archive-empty{margin:24px 0;color:#b7a897;text-align:center}@media(max-width:720px){.typewriter-start{padding:28px 18px}.source-grid{grid-template-columns:1fr}.toolbar-button span{display:none}.studio-panel{left:12px;right:12px;width:auto}}
</style>

<style scoped>
.source-grid{grid-template-columns:repeat(2,minmax(160px,1fr))}.note-picker{max-height:75vh;display:flex;flex-direction:column}.tn-search{padding:10px;color:#f4ecdb;background:#1b130e;border:1px solid #685235;border-radius:5px;margin-bottom:12px}.note-choices{overflow:auto;display:flex;flex-direction:column;gap:7px}.note-choices button{display:flex;flex-direction:column;gap:5px;text-align:left;padding:12px;border:1px solid #685235;border-radius:5px;background:#33261d;color:#f4ecdb;cursor:pointer}.note-choices small{opacity:.6;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.toolbar-title small{font-size:11px;opacity:.65}.language-select{color:#c9bfae;background:#211710;border:1px solid #685235;border-radius:5px;padding:4px}.error,.workspace-error{color:#ffc4a7}.workspace-error{position:absolute;top:45px;z-index:90;background:#38241b;padding:8px}.workspace-toolbar{flex-shrink:0;flex-wrap:wrap;height:auto;min-height:42px}.toolbar-actions{flex-wrap:wrap}
</style>

<style scoped>
/* Friday 的来源选择也使用原作主题 token；舞台内菜单和组件保持原版 CSS。 */
.workspace-toolbar{min-height:34px;background:var(--tn-room-edge);border-color:var(--tn-panel-line);color:var(--tn-panel-ink)}
.toolbar-title span{font-family:var(--tn-font-ui);font-style:italic;color:var(--tn-panel-ink)}
.toolbar-button{font-family:var(--tn-font-ui);font-style:italic;font-size:14px;color:var(--tn-panel-muted)}
.toolbar-button:hover{color:var(--tn-accent);border-color:var(--tn-panel-line);background:rgba(255,255,255,.05)}
.toolbar-title small{font-family:var(--tn-font-ui);color:var(--tn-panel-muted)}
.language-select,.tn-search{background:var(--tn-panel-bg);color:var(--tn-panel-ink);border-color:var(--tn-panel-line);font-family:var(--tn-font-ui)}
.typewriter-dialog{background:var(--tn-panel-bg);color:var(--tn-panel-ink);border-color:var(--tn-panel-line);font-family:var(--tn-font-ui);border-radius:12px;backdrop-filter:blur(16px)}
.panel-heading{color:var(--tn-panel-ink);font-size:20px;font-style:italic;font-weight:400}
.panel-heading button{color:var(--tn-panel-muted)}
.note-choices button{background:rgba(255,255,255,.025);color:var(--tn-panel-ink);border-color:var(--tn-panel-line);font-family:var(--tn-font-ui)}
.note-choices button:hover{background:rgba(255,255,255,.065);border-color:var(--tn-accent)}
.note-choices strong{font-weight:400;font-size:17px}.note-choices small{font-size:13px}
@media(max-width:720px){.workspace-toolbar{padding:4px 10px}.toolbar-actions{gap:2px}.toolbar-title{max-width:36%}.toolbar-button{padding:4px 5px}}
</style>

<style scoped>.workspace-body{display:flex}.workspace-body :deep(.typewriter-original-host){flex:1;min-width:0}.typewriter-preview{flex:1;min-width:0;overflow:auto;padding:34px clamp(18px,6vw,96px);box-sizing:border-box;white-space:normal;line-height:1.7;background:var(--tn-room-bg);color:var(--tn-panel-ink)}.typewriter-preview :deep(img){display:block;max-width:100%;height:auto;margin:1.2em auto;border-radius:6px;box-shadow:0 8px 28px rgba(0,0,0,.2)}.typewriter-preview :deep(pre){overflow:auto;padding:12px;background:rgba(0,0,0,.2);border-radius:6px}.typewriter-preview :deep(a){color:var(--tn-accent)}</style>

<style scoped>
.typewriter-image-input{display:none}
.typewriter-image-strip{display:flex;align-items:center;gap:8px;min-height:132px;padding:8px 14px;overflow:auto;background:var(--tn-room-edge);border-bottom:1px solid var(--tn-panel-line);color:var(--tn-panel-muted)}
.typewriter-image-label{flex:none;font:12px var(--tn-font-ui);font-style:italic}
.typewriter-image-card{display:flex;align-items:center;gap:6px;flex:none;margin:0;padding:3px 6px;border:1px solid var(--tn-panel-line);border-radius:7px;background:rgba(255,255,255,.035)}
.typewriter-image-card img{width:144px;height:112px;object-fit:contain;border-radius:4px;background:rgba(0,0,0,.18)}
.typewriter-image-card figcaption{max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:11px var(--tn-font-ui)}
</style>
