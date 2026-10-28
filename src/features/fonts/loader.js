import {electronService} from '@/services/electron'
import '@fontsource/jetbrains-mono/400.css'
import '@fontsource/jetbrains-mono/700.css'
import '@fontsource/fira-code/400.css'
import '@fontsource/fira-code/700.css'
import '@fontsource/ibm-plex-mono/700.css'
import './fonts.css'

const loaded = new Map()
export async function loadPrivateFont(font) {
  if (!loaded.has(font.id)) loaded.set(font.id, (async () => {
    const result = await electronService.request('fonts-read', {id: font.id})
    const bytes = Uint8Array.from(atob(result.base64), char => char.charCodeAt(0))
    const face = new FontFace(font.family, bytes, {weight: String(font.weight || 400)})
    await face.load(); document.fonts.add(face)
    return face
  })().catch(error => { loaded.delete(font.id); throw error }))
  return loaded.get(font.id)
}

export async function restorePrivateFonts() {
  if (!window.electronAPI) return
  const fonts = await electronService.request('fonts-list')
  await Promise.all(fonts.filter(font => font.installed).map(font => loadPrivateFont(font)))
}

export async function ensureTypeface(family, weight = 400) {
  await document.fonts.load(`${weight} 15px ${family}`, 'Friday 中文 Aa 0123')
  await document.fonts.ready
  if (!document.fonts.check(`${weight} 15px ${family}`, 'Friday 中文')) throw new Error('FONT_LOAD_FAILED')
  window.dispatchEvent(new Event('friday:typography-ready'))
}
