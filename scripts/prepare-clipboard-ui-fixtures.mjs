import { app, BrowserWindow, safeStorage } from 'electron'
import path from 'node:path'
import fs from 'node:fs/promises'
import crypto from 'node:crypto'
import sharp from 'sharp'
import { setDataDir, loadConfig, saveConfig } from '../src-electron/config.js'
import * as db from '../src-electron/db.js'
import { protectedText } from '../src-electron/clipboard-policy.js'
const directory = process.argv.at(-1)
if (!path.isAbsolute(directory) || path.basename(directory) !== 'Friday-preview-clipboard-acceptance') throw new Error('验收样本只能写入专用隔离目录')
app.setPath('userData', path.join(directory, 'fixture-profile'))
app.commandLine.appendSwitch('disable-background-timer-throttling')
app.on('window-all-closed', () => {})
app.whenReady().then(async () => {
let generator
try {
  await fs.mkdir(directory, { recursive: true })
  setDataDir(directory); db.setDataDir(directory); await db.initDb()
  const media = path.join(directory, 'clipboard-media'), fixtures = path.join(directory, 'fixtures')
  await fs.mkdir(media, { recursive: true }); await fs.mkdir(fixtures, { recursive: true })
  const image = path.join(media, crypto.createHash('sha256').update('clipboard-ui-image').digest('hex') + '.png')
  await sharp({ create: { width: 800, height: 450, channels: 3, background: '#c6d9ee' } }).composite([{ input: Buffer.from('<svg width="800" height="450"><rect x="100" y="80" width="600" height="290" rx="28" fill="#456a91"/><text x="400" y="240" font-size="42" text-anchor="middle" fill="white">Friday clipboard preview</text></svg>') }]).png().toFile(image)
  const code = path.join(fixtures, '代码示例.py'), audio = path.join(fixtures, '音频验收.wav'), video = path.join(fixtures, '视频验收.webm')
  await fs.writeFile(code, 'def review_plan():\n    topics = ["notes", "practice"]\n    return topics\n')
  const samples = 22050 * 2, wav = Buffer.alloc(44 + samples * 2)
  wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(22050, 24); wav.writeUInt32LE(44100, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(samples * 2, 40)
  for (let i = 0; i < samples; i++) wav.writeInt16LE(Math.round(Math.sin(i * Math.PI * 2 * 440 / 22050) * 1800), 44 + i * 2)
  await fs.writeFile(audio, wav)
  generator = new BrowserWindow({ show: false, webPreferences: { backgroundThrottling: false, sandbox: true } })
  await generator.loadURL('about:blank')
  const recorded = await generator.webContents.executeJavaScript("new Promise((resolve,reject)=>{const c=document.createElement('canvas');c.width=320;c.height=180;const x=c.getContext('2d'),stream=c.captureStream(15),r=new MediaRecorder(stream,{mimeType:'video/webm;codecs=vp8'}),parts=[];r.ondataavailable=e=>parts.push(e.data);r.onerror=reject;r.onstop=async()=>{const data=await new Blob(parts).arrayBuffer();let s='';for(const v of new Uint8Array(data))s+=String.fromCharCode(v);stream.getTracks().forEach(t=>t.stop());resolve(btoa(s))};let n=0;const timer=setInterval(()=>{x.fillStyle=n%2?'#456a91':'#c6d9ee';x.fillRect(0,0,320,180);x.fillStyle='#fff';x.font='22px sans-serif';x.fillText('Friday preview '+n,35,95);n++},65);r.start();setTimeout(()=>{clearInterval(timer);r.stop()},1100)})")
  await fs.writeFile(video, Buffer.from(recorded, 'base64'))
  generator.destroy(); generator = null
  const folder = path.join(fixtures, '文件夹验收.png')
  await fs.mkdir(folder, { recursive: true })
  await fs.writeFile(path.join(folder, '说明.txt'), 'Friday 文件夹验收样本')
  const capturedAt = new Date().toISOString()
  const base = { capturedAt, sourceApp: 'Friday 验收样本', plainText: '', html: '', filePaths: [], imagePaths: [], imagePath: null, sensitivity: 'normal', tags: [], category: '', pinned: false, favorite: false, usageCount: 0, expiresAt: null, deletedAt: null }
  const entries = [
    { id: 'folder', kind: 'folder', filePaths: [folder], maskedPreview: folder, sourceApp: 'explorer' },
    { id: 'image-file', kind: 'image', filePaths: [image], maskedPreview: '图片文件验收', sourceApp: 'explorer' },
    { id: 'code', kind: 'code', language: 'python', filePaths: [code], maskedPreview: '代码示例.py' },
    { id: 'audio', kind: 'audio', filePaths: [audio], maskedPreview: '音频验收.wav' },
    { id: 'video', kind: 'video', filePaths: [video], maskedPreview: '视频验收.webm' },
    { id: 'image', kind: 'image', imagePath: image, imagePaths: [image], maskedPreview: '图片验收', tags: ['设计'] },
    { id: 'rich', kind: 'html', plainText: '本周学习计划\n先复习，再练习。', html: '<h2>本周学习计划</h2><p><strong>先复习</strong>，再练习。</p>', sourceApp: 'WINWORD', category: '学习', tags: ['计划'], note: '下周回顾', phrase: true, favorite: true },
    { id: 'link', kind: 'link', plainText: 'https://example.com/', maskedPreview: 'https://example.com/', sourceApp: 'chrome' },
    { id: 'files', kind: 'file', filePaths: [code, audio, video], maskedPreview: '3 个文件', sourceApp: 'explorer' },
    { id: 'secret', kind: 'secret', plainText: protectedText('验证码：428619（验收样本）', safeStorage), sensitivity: 'secret', maskedPreview: '••••••••', expiresAt: new Date(Date.now() + 15 * 60000).toISOString() },
    { id: 'long', kind: 'text', plainText: '完整长文本验收\n' + '学习时先理解概念，再通过练习检验理解。\n'.repeat(80) + '可搜索的详情末尾', category: '学习', tags: ['长文本'], sourceApp: 'notepad' }
  ]
  for (const value of entries) {
    const item = { ...base, ...value, id: 'clipboard-ui-' + value.id, hash: crypto.createHash('sha256').update('clipboard-ui-' + value.id).digest('hex') }
    db.queryAllRaw('INSERT OR REPLACE INTO clipboard_items VALUES (?, ?, ?, ?)', [item.id, JSON.stringify(item), item.capturedAt, null])
  }
  saveConfig({ ...loadConfig(), language: 'zh-CN', clipboard: { ...loadConfig().clipboard, shortcutEnabled: false, captureRecordings: false } })
  console.log(JSON.stringify({ ok: true, fixtures: entries.length, audio: true, video: true, code: true }))
} finally { generator?.destroy(); db.closeDb(); app.quit() }
}).catch(error => { console.error(error); app.exit(1) })
