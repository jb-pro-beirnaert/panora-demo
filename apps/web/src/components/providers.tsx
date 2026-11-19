'use client';

import type { ReactNode } from 'react';
import { BrokerProvider } from '@/lib/broker';
import { NotificationsProvider } from '@/lib/notifications';
import { RealtimeProvider } from '@/lib/realtime';

export function Providers({ children }: { children: ReactNode }) {
  return (
    <RealtimeProvider>
      <BrokerProvider>
        <NotificationsProvider>{children}</NotificationsProvider>
      </BrokerProvider>
    </RealtimeProvider>
  );
}
