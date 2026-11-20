import type { Locale, RawEmailInput, ScenarioId } from '@demo/shared';

export type PlayerStatus = 'ready' | 'running' | 'paused' | 'finished';

export interface Timers {
  setTimeout: (callback: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
}

/** One e-mail of the demo script, ready to send (its PDFs already rendered). */
export interface ScriptEmail {
  email: RawEmailInput;
  scenario: ScenarioId;
  /** Kind of a non-claim request (`cancellation`, `quote_request`). */
  requestType: string;
  language: Locale;
}

export interface ScriptItemView {
  index: number;
  scenario: ScenarioId;
  requestType: string;
  language: Locale;
  subject: string;
  sent: boolean;
}

export interface PlayerState {
  status: PlayerStatus;
  sent: number;
  total: number;
  errors: number;
  /** Seconds between two e-mails while playing. */
  intervalSeconds: number;
  next: ScriptItemView | null;
  script: ScriptItemView[];
}

/**
 * Plays the demo script (V14): a fixed list of e-mails, sent in order, one at a time — at a steady
 * pace while playing, or on demand with "Send 1 e-mail". Stops at X/X.
 */
export class DemoPlayer {
  private status: PlayerStatus = 'ready';
  private sent = 0;
  private errors = 0;
  private timer: unknown = null;
  private sending: Promise<void> | null = null;
  private readonly timers: Timers;

  constructor(
    private readonly script: readonly ScriptEmail[],
    private readonly deliver: (email: RawEmailInput) => Promise<void>,
    private intervalSeconds: number,
    timers?: Timers,
  ) {
    if (script.length === 0) throw new Error('the demo script is empty');
    this.timers = timers ?? {
      setTimeout: (callback, ms) => setTimeout(callback, ms),
      clearTimeout: (handle) => clearTimeout(handle as NodeJS.Timeout),
    };
  }

  private view(index: number): ScriptItemView {
    const item = this.script[index]!;
    return {
      index: index + 1,
      scenario: item.scenario,
      requestType: item.requestType,
      language: item.language,
      subject: item.email.subject,
      sent: index < this.sent,
    };
  }

  state(): PlayerState {
    return {
      status: this.status,
      sent: this.sent,
      total: this.script.length,
      errors: this.errors,
      intervalSeconds: this.intervalSeconds,
      next: this.sent < this.script.length ? this.view(this.sent) : null,
      script: this.script.map((_, index) => this.view(index)),
    };
  }

  /** Starts (or resumes) playing: the next e-mail goes out at once, then one per interval. */
  play(): void {
    if (this.status === 'running' || this.status === 'finished') return;
    this.status = 'running';
    this.schedule(0);
  }

  pause(): void {
    if (this.status !== 'running') return;
    this.status = 'paused';
    this.cancel();
  }

  setInterval(seconds: number): void {
    this.intervalSeconds = seconds;
    if (this.status === 'running') {
      this.cancel();
      this.schedule(seconds * 1_000);
    }
  }

  /** Sends the next e-mail of the script now, whether playing or not. Null at X/X. */
  async sendNext(): Promise<RawEmailInput | null> {
    if (this.sending) await this.sending;
    if (this.sent >= this.script.length) return null;
    const item = this.script[this.sent]!;
    this.sending = this.send(item.email);
    try {
      await this.sending;
    } finally {
      this.sending = null;
    }
    return item.email;
  }

  /** Back to 0/X, paused (demo reset). */
  reset(): void {
    this.cancel();
    this.status = 'ready';
    this.sent = 0;
    this.errors = 0;
  }

  /**
   * After a simulator restart without a reset: the e-mails Core already has are not sent again.
   */
  resumeFrom(alreadySent: number): void {
    this.sent = Math.min(this.script.length, Math.max(0, alreadySent));
    this.status = this.sent >= this.script.length ? 'finished' : this.sent > 0 ? 'paused' : 'ready';
  }

  private async send(email: RawEmailInput): Promise<void> {
    try {
      await this.deliver(email);
      this.sent += 1;
    } catch (error) {
      // The e-mail stays next in line: "Send 1 e-mail" or the next tick tries again.
      this.errors += 1;
      console.error('e-mail delivery failed:', error);
    }
    if (this.sent >= this.script.length) {
      this.cancel();
      this.status = 'finished';
    }
  }

  private schedule(delay: number): void {
    this.timer = this.timers.setTimeout(() => {
      this.timer = null;
      if (this.status !== 'running') return;
      void this.sendNext().finally(() => {
        if (this.status === 'running' && this.timer === null) {
          this.schedule(this.intervalSeconds * 1_000);
        }
      });
    }, delay);
  }

  private cancel(): void {
    if (this.timer !== null) this.timers.clearTimeout(this.timer);
    this.timer = null;
  }
}
