/** 从同一 Core 任务的领域事件读取交付，不从成功文案推断文件存在。 */
export function officeTaskRecord(task) {
  return (task?.events || []).filter(event => event.type === 'office.operation.updated').at(-1)?.payload?.record || null
}

export function officeTaskArtifact(task) {
  const artifact = officeTaskRecord(task)?.result?.data?.artifact
  return artifact?.persisted === true && artifact.validation?.valid === true && artifact.path ? artifact : null
}

export function isStandaloneOfficeTask(task) {
  return officeTaskRecord(task)?.ownsCoreTask === true
}
