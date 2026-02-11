'use client'

import { useState, useRef, useEffect } from 'react'
import { Send, TrendingUp, User, Loader2, Wrench, Search, Globe, FileText, Terminal, Sparkles } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism'
import { sentryMetrics, sentryLogger } from '@/lib/sentry-helpers'

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: Date
}

interface ToolStatus {
  name: string
  status: 'running' | 'complete'
  elapsed?: number
}

// Map tool names to friendly display names and icons
const toolDisplayInfo: Record<string, { name: string; icon: 'search' | 'globe' | 'file' | 'terminal' | 'wrench' }> = {
  'WebSearch': { name: 'Web Search', icon: 'search' },
  'WebFetch': { name: 'Fetching URL', icon: 'globe' },
  'Read': { name: 'Reading File', icon: 'file' },
  'Write': { name: 'Writing File', icon: 'file' },
  'Edit': { name: 'Editing File', icon: 'file' },
  'Glob': { name: 'Finding Files', icon: 'file' },
  'Grep': { name: 'Searching Content', icon: 'search' },
  'Bash': { name: 'Running Command', icon: 'terminal' },
  'Task': { name: 'Running Task', icon: 'wrench' },
}

const ToolIcon = ({ type }: { type: 'search' | 'globe' | 'file' | 'terminal' | 'wrench' }) => {
  const iconClass = "w-3 h-3"
  switch (type) {
    case 'search': return <Search className={iconClass} />
    case 'globe': return <Globe className={iconClass} />
    case 'file': return <FileText className={iconClass} />
    case 'terminal': return <Terminal className={iconClass} />
    default: return <Wrench className={iconClass} />
  }
}

const quickPrompts = [
  'Compare Sentry to Datadog APM',
  'What are Sentry\'s main competitors?',
  'Analyze Sentry vs New Relic pricing',
  'Compare error tracking features',
  'Sentry vs Rollbar: Which is better?',
  'Latest features from competitor products',
]

export function CompetitiveResearch() {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'welcome',
      role: 'assistant',
      content: `# Sentry Competitive Research Agent

I'm here to help you research and analyze Sentry's competitive landscape. I can compare Sentry against competitors like:

**APM & Monitoring:**
- Datadog APM
- New Relic
- AppDynamics
- Dynatrace
- Elastic APM

**Error Tracking:**
- Rollbar
- Bugsnag
- Honeybadger
- Raygun

**Session Replay & Frontend:**
- LogRocket
- FullStory
- Hotjar

I'll use web search to gather the latest information about features, pricing, reviews, and market positioning. What would you like to research?`,
      timestamp: new Date()
    }
  ])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [currentTool, setCurrentTool] = useState<ToolStatus | null>(null)
  const [selectedModel, setSelectedModel] = useState<'sonnet' | 'opus' | 'haiku'>('sonnet')
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const modelIds = {
    'sonnet': 'claude-sonnet-4-5-20250929',
    'opus': 'claude-opus-4-6',
    'haiku': 'claude-haiku-4-5-20251001'
  }

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages, currentTool])

  const sendMessage = async (content: string) => {
    if (!content.trim() || isLoading) return

    const messageStartTime = Date.now()

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: content.trim(),
      timestamp: new Date()
    }

    // Track user message metrics
    sentryMetrics.increment('competitive_research.ui.message_sent', 1)
    sentryMetrics.gauge('competitive_research.ui.message_length', content.trim().length)
    sentryMetrics.gauge('competitive_research.ui.conversation_size', messages.length + 1)

    sentryLogger.info('User sent competitive research query', {
      context: {
        messageLength: content.trim().length,
        conversationSize: messages.length + 1,
        messagePreview: content.trim().substring(0, 50),
        model: selectedModel
      }
    })

    setMessages(prev => [...prev, userMessage])
    setInput('')
    setIsLoading(true)
    setCurrentTool(null)

    try {
      const response = await fetch('/api/competitive-research', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messages: [...messages, userMessage].map(m => ({
            role: m.role,
            content: m.content
          })),
          model: modelIds[selectedModel]
        })
      })

      if (!response.ok) {
        sentryMetrics.increment('competitive_research.ui.api_error', 1, {
          tags: { status: response.status.toString() }
        })
        sentryLogger.error('Competitive Research API request failed', {
          context: { status: response.status, statusText: response.statusText }
        })
        throw new Error('Failed to get response')
      }

      sentryLogger.debug('Competitive Research API request successful', {
        context: { status: response.status }
      })

      // Handle SSE streaming response
      const reader = response.body?.getReader()
      if (!reader) {
        throw new Error('No response body')
      }

      const decoder = new TextDecoder()
      let streamingContent = ''
      const streamingMessageId = crypto.randomUUID()
      let toolsEncountered = new Set<string>()
      let chunksReceived = 0

      // Add a placeholder message for streaming content
      setMessages(prev => [...prev, {
        id: streamingMessageId,
        role: 'assistant',
        content: '',
        timestamp: new Date()
      }])

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        const chunk = decoder.decode(value)
        const lines = chunk.split('\n')

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6)
            if (data === '[DONE]') continue

            try {
              const parsed = JSON.parse(data)

              if (parsed.type === 'text_delta') {
                // Append streaming text
                chunksReceived++
                streamingContent += parsed.text
                setCurrentTool(null) // Clear tool status when text starts flowing
                // Update the streaming message
                setMessages(prev => prev.map(msg =>
                  msg.id === streamingMessageId
                    ? { ...msg, content: streamingContent }
                    : msg
                ))
              } else if (parsed.type === 'tool_start') {
                toolsEncountered.add(parsed.tool)
                sentryMetrics.increment('competitive_research.ui.tool_start', 1, {
                  tags: { tool: parsed.tool }
                })
                sentryLogger.debug('Tool started in competitive research UI', {
                  context: { toolName: parsed.tool }
                })

                setCurrentTool({
                  name: parsed.tool,
                  status: 'running'
                })
              } else if (parsed.type === 'tool_progress') {
                setCurrentTool(prev => prev ? {
                  ...prev,
                  elapsed: parsed.elapsed
                } : null)
              } else if (parsed.type === 'done') {
                const responseDuration = (Date.now() - messageStartTime) / 1000

                sentryMetrics.timing('competitive_research.ui.response_time', responseDuration)
                sentryMetrics.gauge('competitive_research.ui.response_length', streamingContent.length)
                sentryMetrics.gauge('competitive_research.ui.stream_chunks', chunksReceived)
                sentryMetrics.gauge('competitive_research.ui.tools_used', toolsEncountered.size)

                sentryLogger.info('Competitive research response completed', {
                  context: {
                    responseDuration,
                    responseLength: streamingContent.length,
                    chunksReceived,
                    toolsUsed: Array.from(toolsEncountered),
                    toolCount: toolsEncountered.size,
                    model: selectedModel
                  }
                })

                setCurrentTool(null)
              } else if (parsed.type === 'error') {
                sentryMetrics.increment('competitive_research.ui.response_error', 1)
                sentryLogger.error('Error in competitive research streaming response', {
                  context: {
                    error: parsed.message,
                    chunksReceived,
                    partialResponseLength: streamingContent.length
                  }
                })

                streamingContent = 'Sorry, I encountered an error processing your request.'
                setMessages(prev => prev.map(msg =>
                  msg.id === streamingMessageId
                    ? { ...msg, content: streamingContent }
                    : msg
                ))
                setCurrentTool(null)
              }
            } catch {
              // Ignore parse errors for incomplete chunks
            }
          }
        }
      }

      // If no content was streamed, remove the placeholder
      if (!streamingContent) {
        setMessages(prev => prev.filter(msg => msg.id !== streamingMessageId))
      }
    } catch (error) {
      const errorDuration = (Date.now() - messageStartTime) / 1000

      sentryMetrics.increment('competitive_research.ui.error', 1)
      sentryMetrics.timing('competitive_research.ui.error_duration', errorDuration)

      sentryLogger.error('Competitive Research UI error', {
        context: {
          error: error instanceof Error ? error.message : 'Unknown error',
          errorDuration,
          conversationSize: messages.length
        },
        error: error instanceof Error ? error : new Error(String(error))
      })

      const errorMessage: Message = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: 'Sorry, I encountered an error. Please check your Claude credentials are configured correctly.',
        timestamp: new Date()
      }
      setMessages(prev => [...prev, errorMessage])
    } finally {
      setIsLoading(false)
      setCurrentTool(null)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    await sendMessage(input)
  }

  const handleQuickPrompt = (prompt: string) => {
    sendMessage(prompt)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit(e)
    }
  }

  return (
    <div className="h-full flex flex-col bg-[#1e1a2a]">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-[#362552] bg-[#2a2438]">
        <div className="flex items-center gap-2">
          <TrendingUp className="w-5 h-5 text-[#7553ff]" />
          <span className="text-sm text-[#e8e4f0]">Competitive Research</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setSelectedModel('haiku')}
            className={`px-2 py-0.5 text-xs rounded transition-colors ${
              selectedModel === 'haiku'
                ? 'bg-[#7553ff] text-white'
                : 'bg-[#1e1a2a] text-[#9086a3] hover:text-[#e8e4f0]'
            }`}
          >
            Haiku
          </button>
          <button
            onClick={() => setSelectedModel('sonnet')}
            className={`px-2 py-0.5 text-xs rounded transition-colors ${
              selectedModel === 'sonnet'
                ? 'bg-[#7553ff] text-white'
                : 'bg-[#1e1a2a] text-[#9086a3] hover:text-[#e8e4f0]'
            }`}
          >
            Sonnet
          </button>
          <button
            onClick={() => setSelectedModel('opus')}
            className={`px-2 py-0.5 text-xs rounded transition-colors ${
              selectedModel === 'opus'
                ? 'bg-[#7553ff] text-white'
                : 'bg-[#1e1a2a] text-[#9086a3] hover:text-[#e8e4f0]'
            }`}
          >
            Opus
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-auto p-4 space-y-4">
        {messages.map((message) => (
          <div
            key={message.id}
            className={`flex gap-3 ${message.role === 'user' ? 'flex-row-reverse' : ''}`}
          >
            <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${
              message.role === 'user' ? 'bg-[#ff45a8]/20' : 'bg-[#7553ff]/20'
            }`}>
              {message.role === 'user' ? (
                <User className="w-4 h-4 text-[#ff45a8]" />
              ) : (
                <Sparkles className="w-4 h-4 text-[#7553ff]" />
              )}
            </div>
            <div
              className={`max-w-[80%] rounded-lg px-3 py-2 ${
                message.role === 'user'
                  ? 'bg-[#ff45a8]/10 text-[#e8e4f0]'
                  : 'bg-[#2a2438] text-[#e8e4f0]'
              }`}
            >
              <div className="text-sm chat-markdown">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={{
                    code({ className, children, ...props }) {
                      const match = /language-(\w+)/.exec(className || '')
                      const isInline = !match && !String(children).includes('\n')
                      return isInline ? (
                        <code className="bg-[#1e1a2a] px-1.5 py-0.5 rounded text-[#ff45a8] text-xs" {...props}>
                          {children}
                        </code>
                      ) : (
                        <SyntaxHighlighter
                          style={oneDark}
                          language={match ? match[1] : 'text'}
                          PreTag="div"
                          customStyle={{
                            margin: '0.5rem 0',
                            padding: '0.75rem',
                            borderRadius: '0.375rem',
                            fontSize: '0.75rem',
                            background: '#1e1a2a',
                          }}
                        >
                          {String(children).replace(/\n$/, '')}
                        </SyntaxHighlighter>
                      )
                    },
                    a({ href, children }) {
                      return (
                        <a href={href} target="_blank" rel="noopener noreferrer" className="text-[#7553ff] hover:text-[#c4b5fd] underline">
                          {children}
                        </a>
                      )
                    },
                    ul({ children }) {
                      return <ul className="list-disc list-inside my-1 space-y-0.5">{children}</ul>
                    },
                    ol({ children }) {
                      return <ol className="list-decimal list-inside my-1 space-y-0.5">{children}</ol>
                    },
                    li({ children }) {
                      return <li className="text-sm">{children}</li>
                    },
                    p({ children }) {
                      return <p className="my-1">{children}</p>
                    },
                    h1({ children }) {
                      return <h1 className="text-lg font-bold mt-2 mb-1 text-[#e8e4f0]">{children}</h1>
                    },
                    h2({ children }) {
                      return <h2 className="text-base font-semibold mt-2 mb-1 text-[#c4b5fd]">{children}</h2>
                    },
                    h3({ children }) {
                      return <h3 className="text-sm font-semibold mt-1.5 mb-0.5 text-[#c4b5fd]">{children}</h3>
                    },
                    blockquote({ children }) {
                      return <blockquote className="border-l-2 border-[#7553ff] pl-2 my-1 text-[#9086a3] italic">{children}</blockquote>
                    },
                    table({ children }) {
                      return <table className="border-collapse my-2 text-xs w-full">{children}</table>
                    },
                    th({ children }) {
                      return <th className="border border-[#362552] px-2 py-1 bg-[#1e1a2a] text-left font-semibold">{children}</th>
                    },
                    td({ children }) {
                      return <td className="border border-[#362552] px-2 py-1">{children}</td>
                    },
                    hr() {
                      return <hr className="border-[#362552] my-2" />
                    },
                  }}
                >
                  {message.content}
                </ReactMarkdown>
              </div>
              <span className="text-[10px] text-[#9086a3] mt-1 block">
                {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>
          </div>
        ))}

        {isLoading && (
          <div className="flex gap-3">
            <div className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center bg-[#7553ff]/20">
              <Sparkles className="w-4 h-4 text-[#7553ff]" />
            </div>
            <div className="bg-[#2a2438] rounded-lg px-3 py-2 space-y-2">
              {currentTool ? (
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1.5 px-2 py-1 bg-[#7553ff]/20 rounded text-[#7553ff]">
                    <ToolIcon type={toolDisplayInfo[currentTool.name]?.icon || 'wrench'} />
                    <span className="text-xs font-medium">
                      {toolDisplayInfo[currentTool.name]?.name || currentTool.name}
                    </span>
                  </div>
                  <Loader2 className="w-3 h-3 text-[#7553ff] animate-spin" />
                  {currentTool.elapsed !== undefined && (
                    <span className="text-[10px] text-[#9086a3]">
                      {currentTool.elapsed.toFixed(1)}s
                    </span>
                  )}
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <Loader2 className="w-4 h-4 text-[#7553ff] animate-spin" />
                  <span className="text-sm text-[#9086a3]">Researching...</span>
                </div>
              )}
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Quick Prompts (show only if no conversation yet) */}
      {messages.length === 1 && !isLoading && (
        <div className="px-4 pb-2">
          <div className="text-xs text-[#9086a3] mb-2">Quick prompts:</div>
          <div className="flex flex-wrap gap-2">
            {quickPrompts.map((prompt, idx) => (
              <button
                key={idx}
                onClick={() => handleQuickPrompt(prompt)}
                className="px-2 py-1 text-xs bg-[#2a2438] hover:bg-[#362552] text-[#c4b5fd] rounded transition-colors"
              >
                {prompt}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Input */}
      <form onSubmit={handleSubmit} className="p-3 border-t border-[#362552] bg-[#2a2438]">
        <div className="flex gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about competitors..."
            className="flex-1 bg-[#1e1a2a] text-[#e8e4f0] text-sm rounded px-3 py-2 border border-[#362552] focus:border-[#7553ff] focus:outline-none resize-none placeholder:text-[#9086a3]"
            rows={2}
            disabled={isLoading}
          />
          <button
            type="submit"
            disabled={isLoading || !input.trim()}
            className="px-3 py-2 bg-[#7553ff] hover:bg-[#8c6fff] disabled:bg-[#362552] disabled:cursor-not-allowed rounded transition-colors"
          >
            <Send className="w-5 h-5 text-white" />
          </button>
        </div>
        <p className="text-[10px] text-[#9086a3] mt-1.5">Press Enter to send, Shift+Enter for new line</p>
      </form>
    </div>
  )
}
