/** 既有 AI Core 任务与事件表共用的进程内缓存。 */
export function createAiCoreStore(database) {
  const live = new Map()
  return Object.freeze({
    saveTask(task) { live.set(task.id, structuredClone(task)); return database.saveAiCoreTask(task) },
    getTask(id) { return structuredClone(live.get(id) || database.getAiCoreTask(id)) },
    listTasks(actorId) {
      const merged = new Map(database.listAiCoreTasks(actorId).map(task => [task.id, task]))
      for (const [id, task] of live) if (!actorId || task.actorId === actorId) merged.set(id, structuredClone(task))
      return [...merged.values()]
    },
    saveEvent: event => database.saveAiCoreTaskEvent(event),
    listEvents: taskId => database.listAiCoreTaskEvents(taskId)
  })
}

let sharedStore = null
export function getAiCoreStore(database) {
  if (!sharedStore) {
    if (!database) throw new TypeError('AI Core task database is required')
    sharedStore = createAiCoreStore(database)
  }
  return sharedStore
}
