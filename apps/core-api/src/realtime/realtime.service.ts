import type { RealtimeEvent } from '@demo/shared';
import { Injectable, type BeforeApplicationShutdown } from '@nestjs/common';
import { Subject, type Observable } from 'rxjs';

/** In-process event bus pushed to the UI over SSE (`GET /realtime`). */
@Injectable()
export class RealtimeService implements BeforeApplicationShutdown {
  private readonly events = new Subject<RealtimeEvent>();
  /** Emits once on shutdown: every SSE stream completes, so the server can actually stop. */
  readonly shutdown = new Subject<void>();

  beforeApplicationShutdown(): void {
    this.shutdown.next();
    this.shutdown.complete();
  }

  publish(
    type: RealtimeEvent['type'],
    caseId: string | null,
    data: RealtimeEvent['data'] = {},
  ): void {
    this.events.next({ type, caseId, data });
  }

  stream(): Observable<RealtimeEvent> {
    return this.events.asObservable();
  }
}
