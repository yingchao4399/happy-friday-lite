/** Core 目录不接纳私有能力，也不接纳剪贴板访问入口。 */
export function isAllowedAiCoreCapability(def) {
  const name = String(def?.name || def?.id || '')
  return !def?.meta?.sensitive && !def?.meta?.privateOnly && !/^clipboard(?:_|$)/i.test(name)
}

export function isWriteCapability(def) {
  return def?.meta?.capabilityType === 'write' || def?.meta?.requireApproval === true ||
    /^(?:office_(?:create|edit|export|batch)|create_|update_|delete_|save_|link_|unlink_)/i.test(String(def?.name || def?.id || ''))
}
