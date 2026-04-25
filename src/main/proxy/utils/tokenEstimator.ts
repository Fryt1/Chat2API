import type { ChatCompletionRequest } from '../types'

export function estimateTokenCount(text: string): number {
  if (!text) return 0
  return Math.max(1, Math.round(text.length / 3.5))
}

function extractMessageText(content: unknown): string {
  if (!content) return ''
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map(item => {
        if (typeof item === 'string') return item
        if (item && typeof item === 'object' && 'text' in item) {
          return String((item as { text?: unknown }).text || '')
        }
        return ''
      })
      .filter(Boolean)
      .join('\n')
  }
  return String(content)
}

export function estimatePromptTokens(request: ChatCompletionRequest): number {
  const text = request.messages
    .map(message => extractMessageText(message.content))
    .filter(Boolean)
    .join('\n')
  return estimateTokenCount(text)
}

export function estimateCompletionTokens(response: any): number {
  if (!response?.choices || !Array.isArray(response.choices)) return 0

  const text = response.choices
    .map((choice: any) => {
      const message = choice?.message
      const delta = choice?.delta
      return [
        extractMessageText(message?.content),
        extractMessageText(message?.reasoning_content),
        extractMessageText(delta?.content),
        extractMessageText(delta?.reasoning_content),
        JSON.stringify(message?.tool_calls || delta?.tool_calls || ''),
      ].filter(Boolean).join('\n')
    })
    .filter(Boolean)
    .join('\n')

  return estimateTokenCount(text)
}

export function applyEstimatedUsage(response: any, request: ChatCompletionRequest): any {
  if (!response || typeof response !== 'object') return response

  const promptTokens = estimatePromptTokens(request)
  const completionTokens = estimateCompletionTokens(response)
  response.usage = {
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: promptTokens + completionTokens,
  }
  return response
}
