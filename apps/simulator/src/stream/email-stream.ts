import type { InboundEmailInput, Locale } from '@demo/shared';

export type StreamStatus = 'ready' | 'running' | 'paused';

export interface Timers {
  setTimeout: (callback: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
}

export interface EmailStreamOptions {
  emailsPerMinute: number;
  /** Share of English e-mails in the stream (0–1). */
  englishShare?: number;
  /** Uniform random number in [0, 1). Injected for reproducible tests. */
  random?: () => number;
  timers?: Timers;
}

export interface StreamState {
  status: StreamStatus;
  emailsPerMinute: number;
  sent: number;
  errors: number;
  poolSize: number;
  englishShare: number;
}

/** A pooled e-mail and the language it is written in. */
export interface PooledEmail {
  email: InboundEmailInput;
  language: Locale;
}

const JITTER = 0.4;

/** Sends the generated e-mails to Core at an adjustable pace, with some randomness between two. */
export class EmailStream {
  private status: StreamStatus = 'ready';
  private readonly cursors: Record<Locale, number> = { fr: 0, en: 0 };
  private readonly byLanguage: Record<Locale, InboundEmailInput[]>;
  private englishShare: number;
  private manual = 0;
  private sent = 0;
  private errors = 0;
  private timer: unknown = null;
  private emailsPerMinute: number;
  private readonly random: () => number;
  private readonly timers: Timers;

  private readonly pool: readonly InboundEmailInput[];

  constructor(
    pool: readonly (InboundEmailInput | PooledEmail)[],
    private readonly deliver: (email: InboundEmailInput) => Promise<void>,
    options: EmailStreamOptions,
  ) {
    if (pool.length === 0) throw new Error('the e-mail pool is empty');
    const pooled = pool.map((item) =>
      'email' in item ? item : { email: item, language: 'fr' as Locale },
    );
    this.pool = pooled.map((item) => item.email);
    this.byLanguage = {
      fr: pooled.filter((item) => item.language === 'fr').map((item) => item.email),
      en: pooled.filter((item) => item.language === 'en').map((item) => item.email),
    };
    this.englishShare = options.englishShare ?? 0;
    this.emailsPerMinute = options.emailsPerMinute;
    this.random = options.random ?? Math.random;
    this.timers = options.timers ?? {
      setTimeout: (callback, ms) => setTimeout(callback, ms),
      clearTimeout: (handle) => clearTimeout(handle as NodeJS.Timeout),
    };
  }

  state(): StreamState {
    return {
      status: this.status,
      emailsPerMinute: this.emailsPerMinute,
      sent: this.sent,
      errors: this.errors,
      poolSize: this.pool.length,
      englishShare: this.englishShare,
    };
  }

  /** Share of English e-mails among the next ones (demo panel's language mix). */
  setEnglishShare(share: number): void {
    this.englishShare = Math.min(1, Math.max(0, share));
  }

  start(): void {
    if (this.status === 'running') return;
    this.status = 'running';
    // The first e-mail goes out at once, so "Start" shows something immediately.
    this.schedule(0);
  }

  pause(): void {
    if (this.status !== 'running') return;
    this.status = 'paused';
    this.cancel();
  }

  resume(): void {
    if (this.status !== 'paused') return;
    this.status = 'running';
    this.schedule(this.nextDelay());
  }

  setSpeed(emailsPerMinute: number): void {
    this.emailsPerMinute = emailsPerMinute;
    if (this.status === 'running') {
      this.cancel();
      this.schedule(this.nextDelay());
    }
  }

  /** Back to `ready` with counters at zero (demo reset). */
  stop(): void {
    this.cancel();
    this.status = 'ready';
    this.cursors.fr = 0;
    this.cursors.en = 0;
    this.manual = 0;
    this.sent = 0;
    this.errors = 0;
  }

  /** One e-mail drawn at random from the pool, outside the stream's sequence. */
  async sendOne(): Promise<InboundEmailInput> {
    const index = Math.floor(this.random() * this.pool.length);
    this.manual += 1;
    const email = withMessageIdSuffix(this.pool[index]!, `m${this.manual}`);
    await this.send(email);
    return email;
  }

  /** Delay before the next e-mail: the average interval ±40 %. */
  nextDelay(): number {
    const average = 60_000 / this.emailsPerMinute;
    return Math.round(average * (1 - JITTER + 2 * JITTER * this.random()));
  }

  /**
   * The next e-mail: its language is drawn with the English share, then the e-mails of that
   * language are sent in pool order. After a full cycle, message ids get a suffix (new e-mails).
   */
  nextEmail(): InboundEmailInput {
    let language: Locale = this.random() < this.englishShare ? 'en' : 'fr';
    if (this.byLanguage[language].length === 0) language = language === 'en' ? 'fr' : 'en';
    const list = this.byLanguage[language];
    const cursor = this.cursors[language];
    this.cursors[language] += 1;
    const email = list[cursor % list.length]!;
    const cycle = Math.floor(cursor / list.length);
    return cycle === 0 ? email : withMessageIdSuffix(email, `c${cycle}`);
  }

  private async send(email: InboundEmailInput): Promise<void> {
    try {
      await this.deliver(email);
      this.sent += 1;
    } catch (error) {
      this.errors += 1;
      console.error('e-mail delivery failed:', error);
    }
  }

  private schedule(delay: number): void {
    this.timer = this.timers.setTimeout(() => {
      this.timer = null;
      if (this.status !== 'running') return;
      void this.send(this.nextEmail()).finally(() => {
        if (this.status === 'running' && this.timer === null) this.schedule(this.nextDelay());
      });
    }, delay);
  }

  private cancel(): void {
    if (this.timer !== null) this.timers.clearTimeout(this.timer);
    this.timer = null;
  }
}

/** `<demo-42-0001@simulator.local>` → `<demo-42-0001.c1@simulator.local>`. */
export function withMessageIdSuffix(email: InboundEmailInput, suffix: string): InboundEmailInput {
  const messageId = email.messageId.includes('@')
    ? email.messageId.replace('@', `.${suffix}@`)
    : `${email.messageId}.${suffix}`;
  return { ...email, messageId };
}
