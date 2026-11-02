import { build } from 'esbuild'

await build({
  entryPoints: ['main.js'],
  bundle: true,
  write: false,
  platform: 'node',
  format: 'esm',
  packages: 'external',
  logLevel: 'silent'
})

console.log('[verify-electron-main-imports] Main-process import graph is valid.')
