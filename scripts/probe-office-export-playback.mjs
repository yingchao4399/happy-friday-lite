// 在真实 Electron 解码器中播放本轮生成的视频和 GIF，不修改系统默认播放器。
import { app, BrowserWindow } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import assert from 'node:assert/strict'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { removePathNoFollowSync } from '../src-electron/fs-safe.js'
const root = fileURLToPath(new URL('../', import.meta.url))
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'friday-export-playback-'))
app.setPath('userData', path.join(data, 'profile'))
app.on('window-all-closed', () => {})
app.whenReady().then(async () => {
  let win, ok = false
  const deadline = setTimeout(() => app.exit(1), 60000)
  try {
    const page = path.join(data, '播放.html')
    fs.writeFileSync(page, '<!doctype html><meta charset="utf-8"><video muted controls></video><img>')
    win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, backgroundThrottling: false } })
    await win.loadFile(page)
    const directory = path.join(root, 'app-data', 'diagnostics', 'office-native-exports')
    const videoUrl = pathToFileURL(path.join(directory, 'slides-验收.mp4')).href
    const gifUrl = pathToFileURL(path.join(directory, 'slides-验收.gif')).href
    const result = await win.webContents.executeJavaScript(`(async () => {
      const video=document.querySelector('video'); video.src=${JSON.stringify(videoUrl)};
      await new Promise((resolve,reject)=>{video.onloadeddata=resolve;video.onerror=()=>reject(new Error('MP4 decode failed'));});
      await video.play();
      const started=video.currentTime;
      await new Promise(resolve=>setTimeout(resolve,500));
      const advanced=video.currentTime>started;
      video.pause();
      const image=document.querySelector('img');image.src=${JSON.stringify(gifUrl)};await image.decode();
      return { advanced,width:video.videoWidth,height:video.videoHeight,duration:video.duration,gifWidth:image.naturalWidth,gifHeight:image.naturalHeight };
    })()`, true)
    assert.equal(result.advanced, true)
    assert.ok(result.width > 0 && result.height === 720 && result.duration >= 9)
    assert.ok(result.gifWidth > 0 && result.gifHeight > 0)
    ok = true; console.log(JSON.stringify({ ok, ...result }))
  } catch (error) { console.error(error.stack) }
  finally {
    clearTimeout(deadline); if (win && !win.isDestroyed()) win.destroy()
    try { removePathNoFollowSync(data, { root: os.tmpdir() }) } catch {}
    app.exit(ok ? 0 : 1)
  }
})
