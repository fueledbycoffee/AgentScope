import { useMemo } from 'react'
import {
  AssistantRuntimeProvider,
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  useExternalStoreRuntime,
  type AppendMessage,
  type ThreadMessageLike,
} from '@assistant-ui/react'

/** One turn of the assistant conversation as the page stores it (also what the API's `history` needs). */
export interface ChatTurn {
  id: string
  role: 'user' | 'assistant'
  content: string
  /** A short receipt under an assistant turn (model, attempts, outcome). Never sent to the server. */
  meta?: string
}

export interface ConversationProps {
  turns: ChatTurn[]
  busy: boolean
  /** Called with the composer text when the user sends; the page owns what happens next. */
  onSend: (text: string) => void
  disabledReason?: string
}

function toThreadMessage(turn: ChatTurn): ThreadMessageLike {
  return { id: turn.id, role: turn.role, content: [{ type: 'text', text: turn.content }] }
}

/**
 * The conversation panel, built on @assistant-ui/react primitives over an external store:
 * the page owns the turns and the pending state; the library renders thread and composer.
 */
export function Conversation({ turns, busy, onSend, disabledReason }: ConversationProps) {
  const runtime = useExternalStoreRuntime<ChatTurn>({
    messages: turns,
    isRunning: busy,
    convertMessage: toThreadMessage,
    onNew: async (message: AppendMessage) => {
      const text = message.content
        .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
        .map(part => part.text)
        .join('\n')
        .trim()
      if (text) onSend(text)
    },
  })
  const metaById = useMemo(() => new Map(turns.map(t => [t.id, t.meta])), [turns])

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ThreadPrimitive.Root className="chat" aria-label="Assistant conversation">
        <ThreadPrimitive.Viewport className="chat-viewport">
          <ThreadPrimitive.Empty>
            <p className="chat-empty">Ask for an analysis to start. Everything you type is sent as data with the profile.</p>
          </ThreadPrimitive.Empty>
          <ThreadPrimitive.Messages
            components={{
              UserMessage: () => (
                <MessagePrimitive.Root className="chat-msg chat-msg-user">
                  <MessagePrimitive.Parts />
                </MessagePrimitive.Root>
              ),
              AssistantMessage: () => (
                <MessagePrimitive.Root className="chat-msg chat-msg-assistant">
                  <MessagePrimitive.Parts />
                  <MessagePrimitive.If hasContent>
                    <span className="chat-meta" data-meta-for={metaById.size} />
                  </MessagePrimitive.If>
                </MessagePrimitive.Root>
              ),
            }}
          />
        </ThreadPrimitive.Viewport>
        <ComposerPrimitive.Root className="chat-composer">
          <ComposerPrimitive.Input
            className="chat-input"
            placeholder={disabledReason ?? 'Ask a question or request a change'}
            aria-label="Message to the assistant"
            disabled={busy || disabledReason !== undefined}
            submitOnEnter
          />
          <ComposerPrimitive.Send
            className="icon-button"
            aria-label="Send"
            data-tip="Send"
            disabled={busy || disabledReason !== undefined}
          >
            <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M2 8h12M9 3l5 5-5 5" />
            </svg>
          </ComposerPrimitive.Send>
        </ComposerPrimitive.Root>
      </ThreadPrimitive.Root>
    </AssistantRuntimeProvider>
  )
}
