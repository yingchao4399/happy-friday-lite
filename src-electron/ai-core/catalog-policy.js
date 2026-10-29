// Core v1 只暴露可审计的应用内能力。Shell、代码执行、包安装、任意网络写入、
// 文件系统代理和批处理仍由 Friday Agent/MCP 的专用策略处理，不能从全局助手
// 的统一入口获得隐式权限。
const CORE_DENYLIST = new Set([
  'execute_command', 'python_repl', 'pip_install', 'write_agent_file',
  'requests_post', 'requests_put', 'requests_patch', 'requests_delete',
  'office_batch', 'transcribe_media', 'ui_perform', 'invoke_app_action',
  'create_automation_task', 'update_automation_task', 'delete_automation_task',
  'create_event', 'update_event', 'delete_event', 'create_drawing',
  'update_drawing', 'layout_drawing', 'link_resources', 'unlink_resources'
])

/** Core 目录不接纳私有能力、剪贴板访问或未纳入 v1 的高影响能力。 */
export function isAllowedAiCoreCapability(def) {
  const name = String(def?.name || def?.id || '')
  return !CORE_DENYLIST.has(name) && !def?.meta?.sensitive && !def?.meta?.privateOnly && !/^clipboard(?:_|$)/i.test(name)
}

export function isWriteCapability(def) {
  return def?.meta?.capabilityType === 'write' || def?.meta?.requireApproval === true ||
    /^(?:office_(?:create|edit|export|batch)|create_|update_|delete_|save_|link_|unlink_)/i.test(String(def?.name || def?.id || ''))
}
