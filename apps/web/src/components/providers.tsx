'use client';

import type { ReactNode } from 'react';
import { BrokerProvider } from '@/lib/broker';
import { RealtimeProvider } from '@/lib/realtime';

export function Providers({ children }: { children: ReactNode }) {
  return (
    <RealtimeProvider>
      <BrokerProvider>{children}</BrokerProvider>
    </RealtimeProvider>
  );
}
