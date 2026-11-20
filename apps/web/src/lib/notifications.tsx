'use client';

import { Mail, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { coreApi } from './api';
import { useRealtime } from './realtime';
import { useStored } from './use-stored';

interface Toast {
  id: number;
  title: string;
  body: string;
  href?: string;
}

interface NotificationsContextValue {
  notify: (toast: Omit<Toast, 'id'>) => void;
  soundEnabled: boolean;
  setSoundEnabled: (enabled: boolean) => void;
}

const NotificationsContext = createContext<NotificationsContextValue | null>(null);

const SOUND_KEY = 'demo.sound';
const TOAST_MS = 5_000;
const MAX_TOASTS = 4;

/** Two short notes (Web Audio, no asset): a proposal waits for the broker. */
function chime(): void {
  try {
    const AudioContextClass =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const context = new AudioContextClass();
    [880, 1320].forEach((frequency, index) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.frequency.value = frequency;
      oscillator.type = 'sine';
      const start = context.currentTime + index * 0.12;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.15, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.25);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(start);
      oscillator.stop(start + 0.3);
    });
    setTimeout(() => void context.close(), 1_000);
  } catch {
    // no audio
  }
}

/**
 * V13 notifications: toasts, an optional sound when a proposal waits for the broker (never one
 * per e-mail: unbearable in a burst), and the number of cases to approve in the tab title.
 */
export function NotificationsProvider({ children }: { children: ReactNode }) {
  const t = useTranslations();
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [soundEnabled, setSound] = useStored<boolean>(SOUND_KEY, false);
  const nextId = useRef(1);
  const lastChime = useRef(0);
  const statsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const baseTitle = useRef<string | null>(null);

  const setSoundEnabled = (enabled: boolean) => {
    setSound(enabled);
    if (enabled) chime();
  };

  const notify = useCallback((toast: Omit<Toast, 'id'>) => {
    const id = nextId.current++;
    setToasts((current) => [...current, { ...toast, id }].slice(-MAX_TOASTS));
    setTimeout(() => setToasts((current) => current.filter((item) => item.id !== id)), TOAST_MS);
  }, []);

  // Tab title: "(3) Claims desk" while 3 cases wait for the broker.
  const refreshTitle = useCallback(() => {
    if (statsTimer.current) return;
    statsTimer.current = setTimeout(() => {
      statsTimer.current = null;
      coreApi
        .stats()
        .then((stats) => {
          baseTitle.current ??= document.title.replace(/^\(\d+\)\s*/, '');
          // V15: cases to approve and cases left to the broker.
          const waiting = stats.awaitingApproval + stats.needsBroker;
          document.title = waiting > 0 ? `(${waiting}) ${baseTitle.current}` : baseTitle.current;
        })
        .catch(() => undefined);
    }, 800);
  }, []);
  useEffect(refreshTitle, [refreshTitle]);

  useRealtime((event) => {
    if (event.type === 'case.action_proposed' || event.type === 'case.updated') refreshTitle();
    if (event.type === 'case.closed' || event.type === 'demo.reset') refreshTitle();
    if (event.type === 'case.action_proposed' && soundEnabled) {
      const now = Date.now();
      if (now - lastChime.current > 2_000) {
        lastChime.current = now;
        chime();
      }
    }
  });

  return (
    <NotificationsContext.Provider value={{ notify, soundEnabled, setSoundEnabled }}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed right-4 bottom-4 z-50 flex w-80 flex-col gap-2"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className="pointer-events-auto flex items-start gap-3 rounded-lg border bg-background p-3 shadow-lg animate-in slide-in-from-right-8 fade-in"
          >
            <Mail className="mt-0.5 size-4 shrink-0 text-blue-600" />
            <a href={toast.href} className="min-w-0 flex-1 text-sm">
              <div className="font-medium">{toast.title}</div>
              <div className="truncate text-muted-foreground">{toast.body}</div>
            </a>
            <button
              type="button"
              aria-label={t('notify.close')}
              className="text-muted-foreground hover:text-foreground"
              onClick={() => setToasts((current) => current.filter((item) => item.id !== toast.id))}
            >
              <X className="size-4" />
            </button>
          </div>
        ))}
      </div>
    </NotificationsContext.Provider>
  );
}

export function useNotifications(): NotificationsContextValue {
  const context = useContext(NotificationsContext);
  if (!context) throw new Error('useNotifications must be used inside <NotificationsProvider>');
  return context;
}
