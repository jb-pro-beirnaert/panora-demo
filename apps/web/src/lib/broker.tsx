'use client';

import type { BrokerView } from '@demo/shared';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { coreApi } from './api';
import { useRealtime } from './realtime';

interface BrokerContextValue {
  /** The demo's only broker (V12, no sign-in); null until the simulator has seeded the data. */
  broker: BrokerView | null;
}

const BrokerContext = createContext<BrokerContextValue | null>(null);

export function BrokerProvider({ children }: { children: ReactNode }) {
  const [broker, setBroker] = useState<BrokerView | null>(null);

  const load = useCallback(() => {
    coreApi
      .broker()
      .then(setBroker)
      .catch(() => setBroker(null));
  }, []);

  useEffect(() => {
    load();
    // The databases are empty for a few seconds after startup: retry until the seed is there.
    const timer = setInterval(() => {
      setBroker((current) => {
        if (!current) load();
        return current;
      });
    }, 2_000);
    return () => clearInterval(timer);
  }, [load]);

  // The seed is replayed after a reset.
  useRealtime((event) => {
    if (event.type === 'demo.reset') setTimeout(load, 1_500);
  });

  return <BrokerContext.Provider value={{ broker }}>{children}</BrokerContext.Provider>;
}

export function useBroker(): BrokerContextValue {
  const context = useContext(BrokerContext);
  if (!context) throw new Error('useBroker must be used inside <BrokerProvider>');
  return context;
}
