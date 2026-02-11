import { query } from '@anthropic-ai/claude-agent-sdk'
import * as Sentry from '@sentry/nextjs'
import { sentryMetrics, sentryLogger } from '@/lib/sentry-helpers'

const SYSTEM_PROMPT = `You are a helpful personal assistant designed to help with general research, questions, and tasks.

Your role is to:
- Answer questions on any topic accurately and thoroughly
- Help with research by searching the web for current information
- Assist with writing, editing, and brainstorming
- Provide explanations and summaries of complex topics
- Help solve problems and think through decisions

Guidelines:
- Be friendly, clear, and conversational
- Use web search when you need current information, facts you're unsure about, or real-time data
- Keep responses concise but complete - expand when the topic warrants depth
- Use markdown formatting when it helps readability (bullet points, code blocks, etc.)
- Be honest when you don't know something and offer to search for answers`

interface MessageInput {
  role: 'user' | 'assistant'
  content: string
}

export async function POST(request: Request) {
  const requestStartTime = Date.now()

  try {
    const { messages } = await request.json() as { messages: MessageInput[] }

    if (!messages || !Array.isArray(messages)) {
      sentryMetrics.increment('chat.api.validation_error', 1, {
        tags: { error_type: 'missing_messages' }
      })
      sentryLogger.warn('Chat API validation failed: missing messages array', {
        context: { hasMessages: !!messages, isArray: Array.isArray(messages) }
      })

      return new Response(
        JSON.stringify({ error: 'Messages array is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }

    // Track message metrics
    const userMessageCount = messages.filter(m => m.role === 'user').length
    const conversationLength = messages.length

    sentryMetrics.increment('chat.api.request', 1, {
      tags: { conversation_length: conversationLength.toString() }
    })
    sentryMetrics.gauge('chat.conversation.messages', conversationLength, {
      tags: { type: 'total' }
    })
    sentryMetrics.gauge('chat.conversation.user_messages', userMessageCount, {
      tags: { type: 'user' }
    })

    // Get the last user message
    const lastUserMessage = messages.filter(m => m.role === 'user').pop()
    if (!lastUserMessage) {
      sentryMetrics.increment('chat.api.validation_error', 1, {
        tags: { error_type: 'no_user_message' }
      })
      sentryLogger.warn('Chat API validation failed: no user message found', {
        context: { messageCount: messages.length, userMessageCount }
      })

      return new Response(
        JSON.stringify({ error: 'No user message found' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }

    sentryLogger.info('Processing chat request', {
      context: {
        conversationLength,
        userMessageCount,
        messagePreview: lastUserMessage.content.substring(0, 100),
        hasContext: conversationLength > 1
      }
    })

    // Build conversation context
    const conversationContext = messages
      .slice(0, -1) // Exclude the last message since we pass it as the prompt
      .map((m: MessageInput) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
      .join('\n\n')

    const fullPrompt = conversationContext
      ? `${SYSTEM_PROMPT}\n\nPrevious conversation:\n${conversationContext}\n\nUser: ${lastUserMessage.content}`
      : `${SYSTEM_PROMPT}\n\nUser: ${lastUserMessage.content}`

    // Create a streaming response
    const encoder = new TextEncoder()
    let toolsUsed = new Set<string>()
    let textChunksStreamed = 0
    const streamStartTime = Date.now()

    const stream = new ReadableStream({
      async start(controller) {
        try {
          sentryLogger.debug('Starting Claude Agent SDK query', {
            context: { promptLength: fullPrompt.length }
          })

          // Use the claude-agent-sdk query function with all default tools enabled
          for await (const message of query({
            prompt: fullPrompt,
            options: {
              maxTurns: 10,
              // Use the preset to enable all Claude Code tools including WebSearch
              tools: { type: 'preset', preset: 'claude_code' },
              // Bypass all permission checks for automated tool execution
              permissionMode: 'bypassPermissions',
              allowDangerouslySkipPermissions: true,
              // Enable partial messages for real-time text streaming
              includePartialMessages: true,
              // Set working directory to the app's directory for sandboxing
              cwd: process.cwd(),
            }
          })) {
            // Handle streaming text deltas (partial messages)
            if (message.type === 'stream_event' && 'event' in message) {
              const event = message.event
              // Handle content block delta events for text streaming
              if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
                textChunksStreamed++
                controller.enqueue(encoder.encode(
                  `data: ${JSON.stringify({ type: 'text_delta', text: event.delta.text })}\n\n`
                ))
              }
            }

            // Send tool start events from assistant messages
            if (message.type === 'assistant' && 'message' in message) {
              const content = message.message?.content
              if (Array.isArray(content)) {
                for (const block of content) {
                  if (block.type === 'tool_use') {
                    toolsUsed.add(block.name)
                    sentryMetrics.increment('chat.tool.used', 1, {
                      tags: { tool_name: block.name }
                    })
                    sentryLogger.info('Tool execution started', {
                      context: { toolName: block.name }
                    })

                    controller.enqueue(encoder.encode(
                      `data: ${JSON.stringify({ type: 'tool_start', tool: block.name })}\n\n`
                    ))
                  }
                }
              }
            }

            // Send tool progress updates
            if (message.type === 'tool_progress') {
              sentryMetrics.gauge('chat.tool.elapsed_time', message.elapsed_time_seconds, {
                tags: { tool_name: message.tool_name }
              })

              controller.enqueue(encoder.encode(
                `data: ${JSON.stringify({ type: 'tool_progress', tool: message.tool_name, elapsed: message.elapsed_time_seconds })}\n\n`
              ))
            }

            // Signal completion
            if (message.type === 'result' && message.subtype === 'success') {
              const streamDuration = (Date.now() - streamStartTime) / 1000

              sentryMetrics.timing('chat.stream.duration', streamDuration, {
                tags: { status: 'success' }
              })
              sentryMetrics.gauge('chat.stream.chunks', textChunksStreamed)
              sentryMetrics.gauge('chat.stream.tools_used', toolsUsed.size)

              sentryLogger.info('Chat request completed successfully', {
                context: {
                  streamDuration,
                  textChunksStreamed,
                  toolsUsed: Array.from(toolsUsed),
                  toolCount: toolsUsed.size
                }
              })

              controller.enqueue(encoder.encode(
                `data: ${JSON.stringify({ type: 'done' })}\n\n`
              ))
            }

            // Handle errors
            if (message.type === 'result' && message.subtype !== 'success') {
              sentryMetrics.increment('chat.api.query_error', 1, {
                tags: { subtype: message.subtype }
              })
              sentryLogger.error('Claude query failed', {
                context: { subtype: message.subtype, toolsUsed: Array.from(toolsUsed) }
              })

              controller.enqueue(encoder.encode(
                `data: ${JSON.stringify({ type: 'error', message: 'Query did not complete successfully' })}\n\n`
              ))
            }
          }

          controller.enqueue(encoder.encode('data: [DONE]\n\n'))
          controller.close()
        } catch (error) {
          const streamDuration = (Date.now() - streamStartTime) / 1000

          sentryMetrics.increment('chat.api.stream_error', 1)
          sentryMetrics.timing('chat.stream.duration', streamDuration, {
            tags: { status: 'error' }
          })

          sentryLogger.error('Stream error occurred', {
            context: {
              error: error instanceof Error ? error.message : 'Unknown error',
              streamDuration,
              textChunksStreamed,
              toolsUsed: Array.from(toolsUsed)
            },
            error: error instanceof Error ? error : new Error(String(error))
          })

          controller.enqueue(encoder.encode(
            `data: ${JSON.stringify({ type: 'error', message: 'Stream error occurred' })}\n\n`
          ))
          controller.close()
        }
      }
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    })
  } catch (error) {
    const requestDuration = (Date.now() - requestStartTime) / 1000

    sentryMetrics.increment('chat.api.error', 1)
    sentryMetrics.timing('chat.api.duration', requestDuration, {
      tags: { status: 'error' }
    })

    sentryLogger.error('Chat API error', {
      context: {
        error: error instanceof Error ? error.message : 'Unknown error',
        requestDuration
      },
      error: error instanceof Error ? error : new Error(String(error))
    })

    return new Response(
      JSON.stringify({ error: 'Failed to process chat request. Check server logs for details.' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}
