import { useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';

export type WsStatus = 'connecting' | 'connected' | 'disconnected';

type EventHandler = (payload: unknown) => void;

export function useSocket(token: string | null) {
  const socketRef = useRef<Socket | null>(null);
  const subscriptions = useRef<Map<string, Set<EventHandler>>>(new Map());
  const [status, setStatus] = useState<WsStatus>(token ? 'connecting' : 'disconnected');

  useEffect(() => {
    if (!token) {
      setStatus('disconnected');
      return;
    }
    const socket = io({
      path: '/socket.io',
      transports: ['websocket'],
      reconnectionDelay: 500,
      reconnectionDelayMax: 5000,
      auth: { token },
    });
    socketRef.current = socket;

    socket.on('connect', () => setStatus('connected'));
    socket.on('disconnect', () => setStatus('disconnected'));
    socket.on('connect_error', () => setStatus('disconnected'));

    // Re-bind any handlers registered before the socket existed (or that
    // should outlive a reconnect — handlers stay alive across reconnects).
    for (const [event, handlers] of subscriptions.current) {
      for (const handler of handlers) socket.on(event, handler);
    }

    return () => {
      socket.close();
      socketRef.current = null;
    };
  }, [token]);

  return {
    status,
    ping: (): Promise<{ sent_at: number | null; server_ts: number; client_id: string } | null> => {
      const socket = socketRef.current;
      if (!socket || !socket.connected) return Promise.resolve(null);
      return new Promise((resolve) => {
        socket
          .timeout(2000)
          .emit('ping', { sent_at: Date.now() }, (_err: unknown, response: unknown) => {
            resolve((response as { sent_at: number | null; server_ts: number; client_id: string }) ?? null);
          });
      });
    },
    on(event: string, handler: EventHandler): () => void {
      let set = subscriptions.current.get(event);
      if (!set) {
        set = new Set();
        subscriptions.current.set(event, set);
      }
      set.add(handler);
      socketRef.current?.on(event, handler);
      return () => {
        set!.delete(handler);
        socketRef.current?.off(event, handler);
      };
    },
  };
}
