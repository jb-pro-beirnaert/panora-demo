'use client';

import { RealtimeEventTypeSchema, type RealtimeEvent } from '@demo/shared';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { CORE_API_URL } from './config';

type Listener = (event: RealtimeEvent) => void;

interface RealtimeContextValue {
  connected: boolean;
  subscribe: (listener: Listener) => () => void;
}

const RealtimeContext = createContext<RealtimeContextValue | null>(null);

/** One SSE connection to Core (`GET /realtime`) shared by the whole page. */
export function RealtimeProvider({ children }: { children: ReactNode }) {
  const listeners = useRef(new Set<Listener>());
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const source = new EventSource(new URL('/realtime', CORE_API_URL), { withCredentials: true });
    source.onopen = () => setConnected(true);
    source.onerror = () => setConnected(false);
    const dispatch = (message: MessageEvent<string>) => {
      try {
        const event = JSON.parse(message.data) as RealtimeEvent;
        for (const listener of listeners.current) listener(event);
      } catch {
        // ignore malformed events
      }
    };
    for (const type of RealtimeEventTypeSchema.options) source.addEventListener(type, dispatch);
    return () => source.close();
  }, []);

  const subscribe = useCallback((listener: Listener) => {
    listeners.current.add(listener);
    return () => {
      listeners.current.delete(listener);
    };
  }, []);
  const value: RealtimeContextValue = { connected, subscribe };
  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>;
}

export function useRealtime(listener?: Listener): { connected: boolean } {
  const context = useContext(RealtimeContext);
  if (!context) throw new Error('useRealtime must be used inside <RealtimeProvider>');
  const latest = useRef(listener);
  useEffect(() => {
    latest.current = listener;
  });
  const { subscribe } = context;
  useEffect(() => subscribe((event) => latest.current?.(event)), [subscribe]);
  return { connected: context.connected };
}
