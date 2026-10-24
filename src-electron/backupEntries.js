// Chromium 运行目录与历史备份不属于可恢复的应用业务数据。
const runtimeEntries = new Set(['electron-user-data', 'backups', 'logs', 'Cache', 'Code Cache', 'GPUCache', 'DawnCache', 'DawnGraphiteCache', 'DawnWebGPUCache', 'Network', 'Session Storage', 'Local Storage', 'Service Worker', 'blob_storage', 'Crashpad', 'Crash Reports', 'IndexedDB', 'Shared Dictionary', 'WebStorage', 'Dictionaries', 'VideoDecodeStats', 'GrShaderCache', 'ShaderCache', 'component_crx_cache', 'extensions_crx_cache'])
export function isBackupEntry(name) {
  return !runtimeEntries.has(name) && !name.startsWith('Singleton') && !name.startsWith('.upgrade-snapshot-') && !/^(?:(?:Cookies|DIPS|SharedStorage)(?:-journal|-wal|-shm)?|lockfile|LOCK|LOG|LOG.old|Preferences|Secure Preferences|Local State|DevToolsActivePort|BrowserMetrics.*)$/i.test(name)
}
