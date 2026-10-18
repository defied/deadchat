// State + streaming for one chat session.
//
// Messages are loaded from the API (the source of truth); live WebSocket
// events for *this* session are layered on top as a "streaming" draft until
// the server reports `done`, after which we re-fetch the persisted messages
// (which include the stored reasoning). Events for other sessions are ignored,
// so switching chats mid-reply never leaks tokens into the wrong conversation.

import { useCallback, useEffect, useRef, useState } from 'react';
import * as chatApi from '../api/chat';
import type { Attachment, ChatMessage } from '../api/chat';
import type { ToolCallEntry } from '../components/ToolCallBlock';
import wsManager, { type WSEvent } from '../api/ws';

export interface StreamState {
  active: boolean;
  thinking: string;
  text: string;
  toolCalls: ToolCallEntry[];
  model?: string;
}

const IDLE: StreamState = { active: false, thinking: '', text: '', toolCalls: [] };
const POLL_MS = 2500;

export function useChatSession(
  sessionId: number | null,
  opts: { onTitle?: (sessionId: number, title: string) => void; onActivity?: () => void } = {},
) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [stream, setStream] = useState<StreamState>(IDLE);
  const [remoteGenerating, setRemoteGenerating] = useState(false);
  /** Session id whose history has finished loading (null while loading). */
  const [readyFor, setReadyFor] = useState<number | null>(null);

  const sessionRef = useRef(sessionId);
  sessionRef.current = sessionId;
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const reload = useCallback(async (id: number) => {
    const { messages: msgs, generating } = await chatApi.getMessages(id);
    if (sessionRef.current !== id) return;
    setMessages(msgs);
    setRemoteGenerating(generating);
  }, []);

  // Load on session change.
  useEffect(() => {
    setStream(IDLE);
    setLoadError(null);
    setRemoteGenerating(false);
    setReadyFor(null);
    if (sessionId == null) {
      setMessages([]);
      return;
    }
    setMessages([]);
    setLoading(true);
    reload(sessionId)
      .catch((err) => {
        if (sessionRef.current === sessionId) {
          setLoadError(err?.response?.status === 404 ? 'not-found' : 'Could not load this chat.');
        }
      })
      .finally(() => {
        if (sessionRef.current === sessionId) {
          setLoading(false);
          setReadyFor(sessionId);
        }
      });
  }, [sessionId, reload]);

  // A reply is being generated but we're not receiving its stream (page was
  // reloaded / socket reconnected mid-reply): poll until it lands.
  useEffect(() => {
    if (!remoteGenerating || stream.active || sessionId == null) return;
    const id = setInterval(() => {
      reload(sessionId).catch(() => {});
    }, POLL_MS);
    return () => clearInterval(id);
  }, [remoteGenerating, stream.active, sessionId, reload]);

  // Live events.
  useEffect(() => {
    return wsManager.onMessage((d: WSEvent) => {
      const current = sessionRef.current;
      if (current == null || d.sessionId !== current) return;

      switch (d.type) {
        case 'start':
          setStream({ ...IDLE, active: true, model: d.model as string });
          setMessages((prev) =>
            prev.map((m) => (m.local === 'pending' ? { ...m, id: d.userMessageId as number, local: undefined } : m)),
          );
          if (d.title) optsRef.current.onTitle?.(current, d.title as string);
          break;
        case 'thinking':
          setStream((s) => ({ ...s, active: true, thinking: s.thinking + (d.content as string) }));
          break;
        case 'token':
          setStream((s) => ({ ...s, active: true, text: s.text + (d.content as string) }));
          break;
        case 'tool_call':
          setStream((s) => ({
            ...s,
            toolCalls: [
              ...s.toolCalls,
              { id: d.toolCallId as string, step: d.step as number, name: d.toolName as string, input: d.toolInput },
            ],
          }));
          break;
        case 'tool_result':
          setStream((s) => ({
            ...s,
            toolCalls: s.toolCalls.map((tc) => (tc.id === d.toolCallId ? { ...tc, result: d.result } : tc)),
          }));
          break;
        case 'done':
          reload(current)
            .catch(() => {})
            .finally(() => {
              if (sessionRef.current === current) setStream(IDLE);
            });
          optsRef.current.onActivity?.();
          break;
        case 'error':
          setStream(IDLE);
          setMessages((prev) => [
            ...prev.map((m) => (m.local === 'pending' ? { ...m, local: undefined } : m)),
            {
              id: `err-${Date.now()}`,
              session_id: current,
              role: 'assistant',
              content: String(d.message || 'Something went wrong'),
              created_at: new Date().toISOString(),
              local: 'error',
            },
          ]);
          break;
      }
    });
  }, [reload]);

  /** Send a message. `targetSession` lets a brand-new chat send before state catches up. */
  const send = useCallback((content: string, attachments: Attachment[] = [], targetSession?: number) => {
    const id = targetSession ?? sessionRef.current;
    if (id == null || (!content.trim() && attachments.length === 0)) return;
    setMessages((prev) => [
      ...prev,
      {
        id: `pending-${Date.now()}`,
        session_id: id,
        role: 'user',
        content,
        attachments,
        created_at: new Date().toISOString(),
        local: 'pending',
      },
    ]);
    setStream({ ...IDLE, active: true });
    wsManager.send({ type: 'chat', sessionId: id, content, attachments });
  }, []);

  const stop = useCallback(() => {
    if (sessionRef.current != null) wsManager.send({ type: 'cancel', sessionId: sessionRef.current });
  }, []);

  return {
    messages,
    loading,
    readyFor,
    loadError,
    stream,
    busy: stream.active || remoteGenerating,
    send,
    stop,
  };
}
