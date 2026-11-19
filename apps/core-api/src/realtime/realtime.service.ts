import type { RealtimeEvent } from '@demo/shared';
import { Injectable } from '@nestjs/common';
import { Subject, type Observable } from 'rxjs';

/** In-process event bus pushed to the UI over SSE (`GET /realtime`). */
@Injectable()
export class RealtimeService {
  private readonly events = new Subject<RealtimeEvent>();

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
