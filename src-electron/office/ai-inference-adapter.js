/** 将 Office 模型调用送入共享、敏感正文不落日志的 AI 推理能力。 */
export function createAiChatCapabilityInvoker(executeCapability, chat) {
  if (typeof executeCapability !== 'function') throw new TypeError('AI 能力执行器未提供')
  if (typeof chat !== 'function') throw new TypeError('模型聊天执行器未提供')

  return function invokeAiChat(messages, tools = [], options = {}) {
    const actor = options.actor || 'office-ai'
    const requestId = options.requestId || `office-ai:${Date.now()}`
    return executeCapability('ai_chat_inference', {
      messages,
      tools,
      stream: options.stream !== false
    }, {
      actor,
      requestId,
      threadId: options.threadId || requestId,
      signal: options.signal,
      emit: options.emit || (() => {}),
      chat: request => chat(request.messages, request.tools || [], options)
    }, {
      actor,
      scopes: options.scopes || ['read']
    })
  }
}
