import {
  AssistantRuntimeProvider,
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  useExternalStoreRuntime,
  type AppendMessage,
  type ThreadMessageLike,
} from '@assistant-ui/react'
import { Icon } from '../components'

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
  /** When set, the composer is disabled and shows why. */
  disabledReason?: string
  status?: string
}

/** The receipt travels as a second text part so it renders under the reply, styled by position. */
function toThreadMessage(turn: ChatTurn): ThreadMessageLike {
  const content: { type: 'text'; text: string }[] = [{ type: 'text', text: turn.content }]
  if (turn.meta) content.push({ type: 'text', text: turn.meta })
  return { id: turn.id, role: turn.role, content }
}

function UserMessage() {
  return (
    <MessagePrimitive.Root className="chat-msg chat-msg-user">
      <MessagePrimitive.Parts />
    </MessagePrimitive.Root>
  )
}

function AssistantMessage() {
  return (
    <MessagePrimitive.Root className="chat-msg chat-msg-assistant">
      <MessagePrimitive.Parts />
    </MessagePrimitive.Root>
  )
}

/**
 * The conversation panel, built on @assistant-ui/react primitives over an external store:
 * the page owns the turns and the pending state; the library renders thread and composer.
 * Everything typed here goes to the server as data (redacted, digest-bound), never as an instruction.
 */
export function Conversation({ turns, busy, onSend, disabledReason, status }: ConversationProps) {
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
  const disabled = busy || disabledReason !== undefined

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ThreadPrimitive.Root className="chat" aria-label="Assistant conversation">
        <ThreadPrimitive.Viewport className="chat-viewport" role="log" aria-live="polite" aria-label="Conversation">
          <ThreadPrimitive.Empty>
            <p className="chat-empty">Send a request to start, for example “Propose a mapping for this file”. Your text is sent as data with the profile.</p>
          </ThreadPrimitive.Empty>
          <ThreadPrimitive.Messages components={{ UserMessage, AssistantMessage }} />
        </ThreadPrimitive.Viewport>
        {status && <p className="chat-status" role="status">{status}</p>}
        <ComposerPrimitive.Root className="chat-composer">
          <ComposerPrimitive.Input
            className="chat-input"
            placeholder={disabledReason ?? 'Ask a question or request a change (Enter to send, Shift+Enter for a new line)'}
            aria-label="Message to the assistant"
            disabled={disabled}
            submitOnEnter
          />
          <ComposerPrimitive.Send className="btn small icon-only has-tip" aria-label="Send" data-tip="Send" disabled={disabled}>
            <Icon name="play" />
          </ComposerPrimitive.Send>
        </ComposerPrimitive.Root>
        {disabledReason && <p className="chat-disabled">{disabledReason}</p>}
      </ThreadPrimitive.Root>
    </AssistantRuntimeProvider>
  )
}
