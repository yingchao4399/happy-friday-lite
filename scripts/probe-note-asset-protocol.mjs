import { app, BrowserWindow, net, protocol } from 'electron'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { setDataDir } from '../src-electron/config.js'
import { NOTE_ASSET_SCHEME, importNoteResource, resolveNoteAssetPath } from '../src-electron/note-resources.js'

protocol.registerSchemesAsPrivileged([{
  scheme: NOTE_ASSET_SCHEME,
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
}])

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'friday-asset-probe-'))
app.setPath('userData', path.join(temp, 'profile'))
app.on('window-all-closed', () => {})

app.whenReady().then(async () => {
  let window
  let exitCode = 1
  try {
    setDataDir(temp)
    protocol.handle(NOTE_ASSET_SCHEME, request => {
      const filePath = resolveNoteAssetPath(request.url)
      if (!filePath) return new Response(null, { status: 404 })
      return net.fetch(pathToFileURL(filePath).href).catch(() => new Response(null, { status: 404 }))
    })

    const source = path.join(temp, 'fixture.png')
    fs.writeFileSync(source, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lWsAAAAASUVORK5CYII=', 'base64'))
    const asset = importNoteResource({ noteId: 'asset_probe', filePath: source })
    const html = path.join(temp, 'probe.html')
    fs.writeFileSync(html, `<!doctype html><meta charset="utf-8"><img id="asset" src="${asset.url}">`)

    window = new BrowserWindow({ show: false, webPreferences: { backgroundThrottling: false } })
    await window.loadFile(html)
    const image = await window.webContents.executeJavaScript(`new Promise(resolve => {
      const element = document.getElementById('asset')
      const result = () => resolve({ complete: element.complete, width: element.naturalWidth, height: element.naturalHeight })
      if (element.complete) result()
      else {
        element.addEventListener('load', result, { once: true })
        element.addEventListener('error', result, { once: true })
        setTimeout(result, 5000)
      }
    })`)
    assert.deepEqual(image, { complete: true, width: 1, height: 1 })
    console.log(JSON.stringify({ ok: true, image, scheme: NOTE_ASSET_SCHEME }))
    exitCode = 0
  } catch (error) {
    console.error(error.stack)
  } finally {
    window?.destroy()
    setDataDir(null)
    // Chromium can hold the temporary profile until the process exits on Windows.
    if (path.dirname(temp) === os.tmpdir()) {
      try { fs.rmSync(temp, { recursive: true, force: true }) } catch (error) {
        if (error.code !== 'EPERM' && error.code !== 'EBUSY') console.warn(error)
      }
    }
    app.exit(exitCode)
  }
})
