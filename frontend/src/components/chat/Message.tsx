import { useState } from 'react';
import { Bot, Brain, ChevronRight, FileText, User } from 'lucide-react';
import type { ChatMessage } from '../../api/chat';
import { isImageAttachment } from '../../api/chat';
import type { StreamState } from '../../hooks/useChatSession';
import { ToolCallBlock } from '../ToolCallBlock';
import { CopyButton, Markdown } from './Markdown';

export function ThinkingBlock({ text, live }: { text: string; live?: boolean }) {
  const [open, setOpen] = useState(false);
  if (!text.trim()) return null;
  const words = text.trim().split(/\s+/).length;
  return (
    <details className="thinking" open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary>
        <Brain size={13} />
        {live ? 'Thinking…' : 'Reasoning'}
        <span style={{ opacity: 0.7 }}>· {words} words</span>
        <ChevronRight size={13} style={{ transform: open ? 'rotate(90deg)' : undefined, transition: 'transform 0.15s' }} />
      </summary>
      <div className="thinking-content">{text}</div>
    </details>
  );
}

function Attachments({ message }: { message: ChatMessage }) {
  if (!message.attachments?.length) return null;
  return (
    <div className="msg-attachments">
      {message.attachments.map((a) =>
        isImageAttachment(a) ? (
          <a key={a.id} href={a.url} target="_blank" rel="noopener noreferrer" title={a.filename}>
            <img className="attachment-thumb" src={a.url} alt={a.filename} />
          </a>
        ) : (
          <a key={a.id} className="attachment-chip" href={a.url} target="_blank" rel="noopener noreferrer">
            <FileText size={13} />
            <span>{a.filename}</span>
          </a>
        ),
      )}
    </div>
  );
}

export function MessageView({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user';
  const isError = message.local === 'error';
  return (
    <div className={`msg ${isUser ? 'msg-user' : 'msg-assistant'}${isError ? ' msg-error' : ''}`}>
      <div className="msg-avatar">{isUser ? <User size={15} /> : <Bot size={15} />}</div>
      <div className="msg-body">
        {!isUser && message.thinking && <ThinkingBlock text={message.thinking} />}
        <Attachments message={message} />
        {(message.content || isUser) && (
          <div className="msg-bubble">
            {isUser ? <div style={{ whiteSpace: 'pre-wrap' }}>{message.content}</div> : <Markdown text={message.content} />}
          </div>
        )}
        {!isUser && !message.content && !isError && (
          <div className="msg-bubble" style={{ color: 'var(--color-text-dim)', fontStyle: 'italic' }}>
            (stopped before answering)
          </div>
        )}
        {!isError && message.content && (
          <div className="msg-tools">
            <CopyButton text={message.content} label="Copy message" />
          </div>
        )}
      </div>
    </div>
  );
}

export function StreamingMessage({ stream }: { stream: StreamState }) {
  const waiting = !stream.text && !stream.thinking && stream.toolCalls.length === 0;
  return (
    <div className="msg msg-assistant">
      <div className="msg-avatar">
        <Bot size={15} />
      </div>
      <div className="msg-body">
        {stream.thinking && <ThinkingBlock text={stream.thinking} live={!stream.text} />}
        {stream.toolCalls.length > 0 && (
          <div>
            {stream.toolCalls.map((tc) => (
              <ToolCallBlock key={tc.id} tc={tc} />
            ))}
          </div>
        )}
        {waiting && (
          <div className="typing" aria-label="Waiting for the model">
            <span />
            <span />
            <span />
          </div>
        )}
        {stream.text && (
          <div className="msg-bubble">
            <Markdown text={stream.text} />
            <span className="cursor" />
          </div>
        )}
      </div>
    </div>
  );
}
