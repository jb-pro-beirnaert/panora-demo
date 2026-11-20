import type { RawEmailInput } from '@demo/shared';

/** `<demo-42-0001@simulator.local>` → `<demo-42-0001.b1-1@simulator.local>`. */
export function withMessageIdSuffix(email: RawEmailInput, suffix: string): RawEmailInput {
  const messageId = email.messageId.includes('@')
    ? email.messageId.replace('@', `.${suffix}@`)
    : `${email.messageId}.${suffix}`;
  return { ...email, messageId };
}

export interface BurstState {
  requested: number;
  sent: number;
  /** Re-sent copies of an e-mail already sent (they must not create a second case). */
  duplicates: number;
  errors: number;
  startedAt: string | null;
  finishedAt: string | null;
}

export const DUPLICATE_SHARE = 0.05;

/**
 * Burst used by the load test (V9; since V14 only from `npm run load-test`, not from the demo): `count` e-mails sent as fast as Core accepts them, each one unique, plus ~5 %
 * duplicates of e-mails already sent to prove the deduplication.
 */
export class Burst {
  state: BurstState = {
    requested: 0,
    sent: 0,
    duplicates: 0,
    errors: 0,
    startedAt: null,
    finishedAt: null,
  };
  private run = 0;

  constructor(
    private readonly pool: readonly RawEmailInput[],
    private readonly deliver: (email: RawEmailInput) => Promise<void>,
    private readonly random: () => number = Math.random,
  ) {}

  /** The e-mails of a burst, duplicates included, in sending order. */
  plan(count: number, run: number): { email: RawEmailInput; duplicate: boolean }[] {
    const unique = Array.from({ length: count }, (_, index) =>
      withMessageIdSuffix(this.pool[index % this.pool.length]!, `b${run}-${index + 1}`),
    );
    const plan: { email: RawEmailInput; duplicate: boolean }[] = [];
    for (const [index, email] of unique.entries()) {
      plan.push({ email, duplicate: false });
      if (index > 0 && this.random() < DUPLICATE_SHARE) {
        plan.push({ email: unique[Math.floor(this.random() * index)]!, duplicate: true });
      }
    }
    return plan;
  }

  start(count: number, concurrency = 20): BurstState {
    this.run += 1;
    const plan = this.plan(count, this.run);
    this.state = {
      requested: count,
      sent: 0,
      duplicates: 0,
      errors: 0,
      startedAt: new Date().toISOString(),
      finishedAt: null,
    };
    let next = 0;
    const worker = async () => {
      while (next < plan.length) {
        const item = plan[next++]!;
        try {
          await this.deliver(item.email);
          if (item.duplicate) this.state.duplicates += 1;
          else this.state.sent += 1;
        } catch {
          this.state.errors += 1;
        }
      }
    };
    void Promise.all(Array.from({ length: concurrency }, worker)).then(() => {
      this.state.finishedAt = new Date().toISOString();
    });
    return this.state;
  }
}
