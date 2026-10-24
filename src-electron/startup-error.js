import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { dialog, shell } from 'electron'

const root = fileURLToPath(new URL('../', import.meta.url))

export async function showStartupError(error, dataDir, window) {
  let language = 'zh-CN'
  try { if (JSON.parse(fs.readFileSync(path.join(dataDir, 'config.json'), 'utf8')).language === 'en-US') language = 'en-US' } catch {}
  const messages = JSON.parse(fs.readFileSync(path.join(root, 'src/i18n/locales', language, 'startup.json'), 'utf8'))
  const result = await dialog.showMessageBox(window, {
    type: 'error', title: messages.title,
    message: error.code === 'DATABASE_FILE_EMPTY' ? messages.emptyDatabase : messages.initializationFailed,
    detail: `${messages.preserved}\n${dataDir}\n\n${messages.reason}: ${error.code || error.message}`,
    buttons: [messages.openDataDirectory, messages.close], defaultId: 0, cancelId: 1,
  })
  if (result.response === 0) await shell.openPath(dataDir)
}
