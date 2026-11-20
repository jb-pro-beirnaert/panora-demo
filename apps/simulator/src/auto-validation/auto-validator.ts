import { CaseDetailSchema, RealtimeEventSchema, type DecisionRequest } from '@demo/shared';

export interface AutoValidationSettings {
  enabled: boolean;
  /** Delay before the simulated broker decides. */
  delayMs: number;
  /** Share of proposals rejected with a comment (0–1). */
  rejectionRate: number;
}

/** A proposal is rejected at most this many times, so every case ends up approved. */
export const MAX_REJECTIONS = 2;

export const REJECTION_COMMENTS = [
  "Ajoute qu'il ne faut pas jeter les éléments endommagés avant l'expertise.",
  'Sois plus concis et rappelle le numéro de contrat dans le premier paragraphe.',
  'Précise le délai dans lequel le client doit nous répondre.',
  'Le ton est trop formel, reformule plus simplement.',
];

/** The simulated broker's decision on revision `revision` of a proposal. */
export function chooseDecision(
  random: () => number,
  rejectionRate: number,
  revision: number,
): DecisionRequest {
  if (revision <= MAX_REJECTIONS && random() < rejectionRate) {
    const comment = REJECTION_COMMENTS[Math.floor(random() * REJECTION_COMMENTS.length)]!;
    return { approved: false, comment };
  }
  return { approved: true };
}

/** Core sends a heartbeat every 15 s: silence for longer means a dead connection. */
export const SSE_IDLE_TIMEOUT_MS = 45_000;

/** Parses an SSE stream into `{ event, data }` messages. */
export async function* readSse(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<{ event: string; data: string }> {
  const decoder = new TextDecoder();
  let buffer = '';
  for await (const chunk of body) {
    buffer += decoder.decode(chunk, { stream: true });
    let separator: number;
    while ((separator = buffer.search(/\r?\n\r?\n/)) !== -1) {
      const raw = buffer.slice(0, separator);
      buffer = buffer.slice(separator).replace(/^\r?\n\r?\n/, '');
      let event = 'message';
      const data: string[] = [];
      for (const line of raw.split(/\r?\n/)) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
      }
      if (data.length > 0) yield { event, data: data.join('\n') };
    }
  }
}

/**
 * Simulated broker of the load test (V9; since V14 it is no longer part of the demo): listens to
 * Core's realtime stream and decides each proposed action after a delay, approving most of them
 * and rejecting some with a comment.
 */
export class AutoValidator {
  settings: AutoValidationSettings = { enabled: false, delayMs: 5_000, rejectionRate: 0.2 };
  decisions = { approved: 0, rejected: 0 };
  private readonly pending = new Set<NodeJS.Timeout>();
  private abort: AbortController | null = null;

  constructor(
    private readonly coreUrl: string,
    /** Demo admin token (Core's metrics and admin routes). */
    private readonly adminToken: string,
    private readonly random: () => number = Math.random,
  ) {}

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return { authorization: `Bearer ${this.adminToken}`, ...extra };
  }

  update(settings: Partial<AutoValidationSettings>): AutoValidationSettings {
    this.settings = { ...this.settings, ...settings };
    if (!this.settings.enabled) this.cancelPending();
    return this.settings;
  }

  cancelPending(): void {
    for (const timer of this.pending) clearTimeout(timer);
    this.pending.clear();
  }

  reset(): void {
    this.cancelPending();
    this.decisions = { approved: 0, rejected: 0 };
  }

  /** Connects to `GET /realtime` and reconnects forever. */
  listen(): void {
    void (async () => {
      for (;;) {
        this.abort = new AbortController();
        const abort = this.abort;
        let idle = setTimeout(() => abort.abort(), SSE_IDLE_TIMEOUT_MS);
        try {
          const response = await fetch(new URL('/realtime', this.coreUrl), {
            signal: abort.signal,
            headers: this.headers({ accept: 'text/event-stream' }),
          });
          if (response.ok && response.body) {
            for await (const message of readSse(response.body)) {
              clearTimeout(idle);
              idle = setTimeout(() => abort.abort(), SSE_IDLE_TIMEOUT_MS);
              this.onMessage(message.data);
            }
          }
        } catch {
          // Core not up yet, restarted, or silent for too long: reconnect below.
        } finally {
          clearTimeout(idle);
        }
        await new Promise((resolve) => setTimeout(resolve, 2_000));
      }
    })();
  }

  onMessage(data: string): void {
    let parsed;
    try {
      parsed = RealtimeEventSchema.safeParse(JSON.parse(data));
    } catch {
      return;
    }
    if (!parsed.success) return;
    const event = parsed.data;
    if (event.type !== 'case.action_proposed' || !event.caseId || !this.settings.enabled) return;
    const revision = typeof event.data.revision === 'number' ? event.data.revision : 1;
    const caseId = event.caseId;
    const timer = setTimeout(() => {
      this.pending.delete(timer);
      void this.decide(caseId, revision).catch((error) =>
        console.error(`auto-validation of ${caseId} failed:`, error),
      );
    }, this.settings.delayMs);
    this.pending.add(timer);
  }

  async decide(caseId: string, revision: number): Promise<void> {
    if (!this.settings.enabled) return;
    const response = await fetch(new URL(`/cases/${caseId}`, this.coreUrl), {
      headers: this.headers(),
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) return;
    const kase = CaseDetailSchema.parse(await response.json());
    const pending = kase.proposedActions.find((action) => action.status === 'pending');
    // Already decided by a human in the meantime.
    if (kase.status !== 'awaiting_approval' || pending?.revision !== revision) return;
    const decision = chooseDecision(this.random, this.settings.rejectionRate, revision);
    const posted = await fetch(new URL(`/cases/${caseId}/decision`, this.coreUrl), {
      method: 'POST',
      headers: this.headers({ 'content-type': 'application/json' }),
      body: JSON.stringify(decision),
      signal: AbortSignal.timeout(5_000),
    });
    if (posted.ok) this.decisions[decision.approved ? 'approved' : 'rejected'] += 1;
  }
}
