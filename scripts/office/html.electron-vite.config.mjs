import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { htmlHostAdapterPlugin } from './html-host-adapter.mjs'
import { htmlPreviewSecurityPlugin } from './html-renderer-adapter.mjs'
import { fridayHtmlProductPlugin } from './html-identity-history-adapter.mjs'
import { htmlErrorAdapterPlugin } from './html-error-adapter.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const require = createRequire(path.join(root, 'vendor/genoffice-html/package.json'))
const { defineConfig, externalizeDepsPlugin } = await import(pathToFileURL(require.resolve('electron-vite')).href)
const { default: react } = await import(pathToFileURL(require.resolve('@vitejs/plugin-react')).href)
export default defineConfig({
  main: { plugins: [externalizeDepsPlugin({ exclude: ['@genoffice/i18n', '@genoffice/electron-utils'] })] },
  preload: { plugins: [htmlHostAdapterPlugin(), externalizeDepsPlugin({ exclude: ['@genoffice/i18n', '@genoffice/electron-utils'] })] },
  renderer: { resolve: { dedupe: ['react', 'react-dom'] }, plugins: [fridayHtmlProductPlugin(), htmlHostAdapterPlugin(), htmlErrorAdapterPlugin(), htmlPreviewSecurityPlugin(), react()] },
})
