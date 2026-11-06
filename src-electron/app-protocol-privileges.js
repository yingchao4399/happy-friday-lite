import { protocol } from 'electron'
import { NOTE_ASSET_SCHEME } from './note-resources.js'

// Electron 每个进程只接受一次特权协议注册。主程序与独立 Office 宿主
// 共用这个启动模块，避免导入顺序导致 Office 或正文图片协议被遗漏。
protocol.registerSchemesAsPrivileged([
  { scheme: NOTE_ASSET_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
  { scheme: 'genoffice-app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true, codeCache: true } },
  { scheme: 'genoffice-docx-media', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
  { scheme: 'html-preview', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
  { scheme: 'html-asset', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }
])
