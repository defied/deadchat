import { useEffect, useRef } from 'react';
import type { ChatMessage as ChatMessageType } from '../api/chat';
import { ChatMessage } from './ChatMessage';
import { StreamingText } from './StreamingText';
import { MessageSquare } from 'lucide-react';

interface ChatWindowProps {
  messages: ChatMessageType[];
  isStreaming: boolean;
  streamingText: string;
}

export function ChatWindow({ messages, isStreaming, streamingText }: ChatWindowProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingText]);

  if (messages.length === 0 && !isStreaming) {
    return (
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 12,
          color: 'var(--color-text-dim)',
          padding: 40,
        }}
      >
        <div
          style={{
            width: 64,
            height: 64,
            borderRadius: 16,
            background: 'var(--color-surface-light)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--color-text-dim)',
          }}
        >
          <MessageSquare size={28} />
        </div>
        <div style={{ fontSize: 16, fontWeight: 500, color: 'var(--color-text-secondary)' }}>
          Start a conversation
        </div>
        <div style={{ fontSize: 14, maxWidth: 400, textAlign: 'center', lineHeight: 1.6 }}>
          Type a message below to begin chatting with your AI assistant.
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        flex: 1,
        overflowY: 'auto',
        padding: '20px 24px',
      }}
    >
      {messages.map((msg) => (
        <ChatMessage key={msg.id} message={msg} />
      ))}
      {isStreaming && streamingText && <StreamingText text={streamingText} />}
      {isStreaming && !streamingText && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '12px 0',
            color: 'var(--color-text-dim)',
            fontSize: 13,
          }}
        >
          <div
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: 'var(--color-accent)',
              animation: 'pulse 1s infinite',
            }}
          />
          Thinking...
        </div>
      )}
      <div ref={bottomRef} />
    </div>
  );
}