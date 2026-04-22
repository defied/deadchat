import { useEffect, useRef, useCallback } from 'react';
import wsManager from '../api/ws';

interface WSMessage {
  type: string;
  [key: string]: unknown;
}

export function useWebSocket(
  token: string | null,
  onMessage?: (data: WSMessage) => void
) {
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  useEffect(() => {
    if (!token) return;

    wsManager.connect(token);

    const unsubMessage = wsManager.onMessage((data) => {
      onMessageRef.current?.(data as WSMessage);
    });

    return () => {
      unsubMessage();
      wsManager.disconnect();
    };
  }, [token]);

  const send = useCallback((data: unknown) => {
    wsManager.send(data);
  }, []);

  return { send, isConnected: wsManager.isConnected };
}
