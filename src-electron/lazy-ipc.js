// 先注册轻量入口，首次请求时加载整个命令组；保留外层权限校验与审计。
export function registerLazyIpcGroup(ipc, channels, register) {
  const expected = new Set(channels), handlers = new Map()
  let pending = null, ready = false
  const ensure = () => {
    if (!pending) pending = Promise.resolve().then(async () => {
      const collected = new Map()
      await register({ handle(channel, handler) {
        if (!expected.has(channel) || collected.has(channel)) throw new Error(`LAZY_IPC_CHANNEL_INVALID: ${channel}`)
        collected.set(channel, handler)
      } })
      if (collected.size !== expected.size) throw new Error('LAZY_IPC_CHANNEL_MISSING')
      for (const [channel, handler] of collected) handlers.set(channel, handler)
      ready = true
    }).catch(error => { pending = null; throw error })
    return pending
  }
  for (const channel of channels) ipc.handle(channel, async (event, ...args) => {
    await ensure()
    return handlers.get(channel)(event, ...args)
  })
  return { ensure, isLoaded: () => ready }
}
