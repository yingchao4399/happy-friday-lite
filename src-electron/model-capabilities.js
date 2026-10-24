// 区分已知不支持与尚待接口验证，不能把可聊天等同于可转写音频。
export function transcriptionCapability(model) {
  let hostname = ''
  try { hostname = new URL(model?.baseUrl).hostname.toLowerCase() } catch {}
  if (model?.capabilities?.transcription === false || hostname === 'api.deepseek.com' || /(?:^|\/)deepseek(?:-|$)/i.test(model?.modelName || '')) {
    return { supported: false, code: 'MEDIA_TRANSCRIPTION_CHAT_ONLY', nextStep: 'configure_transcription_model' }
  }
  return { supported: model?.capabilities?.transcription === true ? true : null, code: null, nextStep: 'verify_transcription_endpoint' }
}
