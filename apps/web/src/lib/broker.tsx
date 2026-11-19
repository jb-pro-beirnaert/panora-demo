'use client';

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { usePathname, useRouter } from '@/i18n/navigation';
import { ApiError, coreApi, type SignedInBroker } from './api';

interface BrokerContextValue {
  /** The signed-in broker (V10), null while loading or signed out. */
  broker: SignedInBroker | null;
  signOut: () => Promise<void>;
}

const BrokerContext = createContext<BrokerContextValue | null>(null);

/** The broker's session: everything the UI shows is limited to their brokerage (by Core). */
export function BrokerProvider({ children }: { children: ReactNode }) {
  const [broker, setBroker] = useState<SignedInBroker | null>(null);
  const router = useRouter();
  const pathname = usePathname();

  const load = useCallback(() => {
    coreApi
      .me()
      .then((me) => setBroker(me.kind === 'broker' ? me : null))
      .catch((error) => {
        setBroker(null);
        if (error instanceof ApiError && error.status === 401 && pathname !== '/login') {
          router.replace('/login');
        }
      });
  }, [pathname, router]);

  useEffect(load, [load]);

  const signOut = async () => {
    await coreApi.logout().catch(() => undefined);
    setBroker(null);
    router.replace('/login');
  };

  return <BrokerContext.Provider value={{ broker, signOut }}>{children}</BrokerContext.Provider>;
}

export function useBroker(): BrokerContextValue {
  const context = useContext(BrokerContext);
  if (!context) throw new Error('useBroker must be used inside <BrokerProvider>');
  return context;
}
