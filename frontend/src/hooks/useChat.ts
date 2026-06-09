import { useState, useCallback, useRef } from 'react';
import type { ChatMessage } from '../api/chat';
import type { ToolCallEntry } from '../components/ToolCallBlock';
import wsManager from '../api/ws';

interface Attachment {
  id: string;
  filename: string;
  url: string;
  type: string;
}

export function useChat(sessionId: string | null) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const [toolCalls, setToolCalls] = useState<ToolCallEntry[]>([]);
  const streamingTextRef = useRef('');
  const toolCallsRef = useRef<ToolCallEntry[]>([]);

  const handleWSMessage = useCallback(
    (data: { type: string; [key: string]: unknown }) => {
      if (data.type === 'token') {
        const token = data.content as string;
        streamingTextRef.current += token;
        setStreamingText(streamingTextRef.current);
      } else if (data.type === 'tool_call') {
        const entry: ToolCallEntry = {
          id: data.toolCallId as string,
          step: data.step as number,
          name: data.toolName as string,
          input: data.toolInput,
        };
        toolCallsRef.current = [...toolCallsRef.current, entry];
        setToolCalls([...toolCallsRef.current]);
      } else if (data.type === 'tool_result') {
        toolCallsRef.current = toolCallsRef.current.map((tc) =>
          tc.id === (data.toolCallId as string) ? { ...tc, result: data.result } : tc
        );
        setToolCalls([...toolCallsRef.current]);
      } else if (data.type === 'done') {
        const finalText = streamingTextRef.current;
        if (finalText) {
          const assistantMsg: ChatMessage = {
            id: (data.messageId as string) || crypto.randomUUID(),
            sessionId: sessionId || '',
            role: 'assistant',
            content: finalText,
            createdAt: new Date().toISOString(),
          };
          setMessages((prev) => [...prev, assistantMsg]);
        }
        streamingTextRef.current = '';
        setStreamingText('');
        toolCallsRef.current = [];
        setToolCalls([]);
        setIsStreaming(false);
      } else if (data.type === 'error') {
        const errorMsg: ChatMessage = {
          id: crypto.randomUUID(),
          sessionId: sessionId || '',
          role: 'assistant',
          content: `Error: ${data.message || 'Something went wrong'}`,
          createdAt: new Date().toISOString(),
        };
        setMessages((prev) => [...prev, errorMsg]);
        streamingTextRef.current = '';
        setStreamingText('');
        toolCallsRef.current = [];
        setToolCalls([]);
        setIsStreaming(false);
      }
    },
    [sessionId]
  );

  const sendMessage = useCallback(
    (content: string, attachments?: Attachment[]) => {
      if (!sessionId || !content.trim()) return;

      const userMsg: ChatMessage = {
        id: crypto.randomUUID(),
        sessionId,
        role: 'user',
        content,
        attachments,
        createdAt: new Date().toISOString(),
      };

      setMessages((prev) => [...prev, userMsg]);
      setIsStreaming(true);
      streamingTextRef.current = '';
      setStreamingText('');
      toolCallsRef.current = [];
      setToolCalls([]);

      wsManager.send({
        type: 'chat',
        sessionId,
        content,
        attachments: attachments?.map((a) => a.id),
      });
    },
    [sessionId]
  );

  const setInitialMessages = useCallback((msgs: ChatMessage[]) => {
    setMessages(msgs);
  }, []);

  return {
    messages,
    isStreaming,
    streamingText,
    toolCalls,
    sendMessage,
    setInitialMessages,
    handleWSMessage,
  };
}
