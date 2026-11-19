'use client';

import type { BrokerView } from '@demo/shared';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { coreApi } from './api';
import { useRealtime } from './realtime';

const STORAGE_KEY = 'demo.brokerId';

function readStoredBrokerId(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

interface BrokerContextValue {
  brokers: BrokerView[];
  broker: BrokerView | null;
  select: (brokerId: string) => void;
}

const BrokerContext = createContext<BrokerContextValue | null>(null);

/** V3 "sign-in": the broker picked in the header, remembered in the browser. */
export function BrokerProvider({ children }: { children: ReactNode }) {
  const [brokers, setBrokers] = useState<BrokerView[]>([]);
  const [brokerId, setBrokerId] = useState<string | null>(null);

  const load = useCallback(() => {
    coreApi
      .brokers()
      .then((list) => {
        setBrokers(list);
        setBrokerId((current) => current ?? readStoredBrokerId());
      })
      .catch(() => setBrokers([]));
  }, []);

  useEffect(load, [load]);

  // The seed is replayed after a reset: reload the list.
  useRealtime((event) => {
    if (event.type === 'demo.reset') setTimeout(load, 1_500);
  });

  const select = (id: string) => {
    setBrokerId(id);
    try {
      window.localStorage.setItem(STORAGE_KEY, id);
    } catch {
      // storage unavailable
    }
  };

  const broker = brokers.find((candidate) => candidate.id === brokerId) ?? brokers[0] ?? null;
  return (
    <BrokerContext.Provider value={{ brokers, broker, select }}>{children}</BrokerContext.Provider>
  );
}

export function useBroker(): BrokerContextValue {
  const context = useContext(BrokerContext);
  if (!context) throw new Error('useBroker must be used inside <BrokerProvider>');
  return context;
}
