import { Controller, Sse, type MessageEvent } from '@nestjs/common';
import { interval, map, merge, takeUntil, type Observable } from 'rxjs';
import { RealtimeService } from './realtime.service.js';

const HEARTBEAT_MS = 15_000;

@Controller('realtime')
export class RealtimeController {
  constructor(private readonly realtime: RealtimeService) {}

  /** Server-sent events: `case.created`, `case.step`, `case.action_proposed`, `case.closed`… */
  @Sse()
  stream(): Observable<MessageEvent> {
    const events = this.realtime
      .stream()
      .pipe(map((event): MessageEvent => ({ type: event.type, data: event })));
    // Keeps proxies from closing an idle connection.
    const heartbeat = interval(HEARTBEAT_MS).pipe(
      map((): MessageEvent => ({ type: 'heartbeat', data: {} })),
    );
    // Without this, a stopping server waits for the open streams forever (and keeps clients
    // attached to a process that no longer accepts connections).
    return merge(events, heartbeat).pipe(takeUntil(this.realtime.shutdown));
  }
}
