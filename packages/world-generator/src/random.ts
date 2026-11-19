import { Faker, base, en, fr } from '@faker-js/faker';

/** A seeded Faker instance. Every random choice of the generator goes through one of these. */
export function createRandom(seed: number): Faker {
  const faker = new Faker({ locale: [fr, base] });
  faker.seed(seed);
  return faker;
}

/** A seeded English Faker, independent from the French one (adding English data never shifts the French world). */
export function createEnglishRandom(seed: number): Faker {
  const faker = new Faker({ locale: [en, base] });
  faker.seed(seed + 1_000_003);
  return faker;
}

export function pick<T>(faker: Faker, items: readonly T[]): T {
  return faker.helpers.arrayElement(items as T[]);
}

export function int(faker: Faker, min: number, max: number): number {
  return faker.number.int({ min, max });
}

/** Rounds to a "human" amount (multiple of `step`). */
export function roundTo(value: number, step: number): number {
  return Math.max(step, Math.round(value / step) * step);
}

// --- Dates (calendar dates as `YYYY-MM-DD`, always in UTC) ---

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** `2026-11-15` → `15/11/2026`. */
export function frDate(date: string): string {
  const [y, m, d] = date.split('-');
  return `${d}/${m}/${y}`;
}

/** `2026-11-15` → `15/11`. */
export function frShortDate(date: string): string {
  return frDate(date).slice(0, 5);
}

export function isoDateTime(date: string, hour: number, minute: number): string {
  const hh = String(hour).padStart(2, '0');
  const mm = String(minute).padStart(2, '0');
  return `${date}T${hh}:${mm}:00.000Z`;
}

// --- Amounts (euros), French formatting with plain spaces so output is stable across ICU versions ---

function groupThousands(value: number): string {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

/** `1450` → `1 450 €`. */
export function frAmount(value: number): string {
  return `${groupThousands(value)} €`;
}

/** `1208.33` → `1 208,33 €`. */
export function frMoney(value: number): string {
  const [units = '0', cents = '00'] = value.toFixed(2).split('.');
  return `${groupThousands(Number(units))},${cents} €`;
}

/** `2300` → `EUR 2,300`. */
export function enAmount(value: number): string {
  return `EUR ${value.toLocaleString('en-US')}`;
}

/** `1208.33` → `EUR 1,208.33`. */
export function enMoney(value: number): string {
  return `EUR ${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const EN_MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** `2026-11-15` → `15 November 2026`. */
export function enDate(date: string): string {
  const [year, month, day] = date.split('-');
  return `${Number(day)} ${EN_MONTHS[Number(month) - 1]} ${year}`;
}

/** `2026-11-15` → `15 November`. */
export function enShortDate(date: string): string {
  return enDate(date).replace(/ \d{4}$/, '');
}

// --- Identifiers ---

export function slugify(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/** A 9-digit SIREN that passes the Luhn check, like real ones. */
export function siren(faker: Faker): string {
  const digits = Array.from({ length: 8 }, () => int(faker, 0, 9));
  digits[0] = int(faker, 1, 9);
  for (let check = 0; check <= 9; check++) {
    const candidate = [...digits, check];
    const sum = candidate.reduce((acc, digit, index) => {
      const doubled = index % 2 === 1 ? digit * 2 : digit;
      return acc + (doubled > 9 ? doubled - 9 : doubled);
    }, 0);
    if (sum % 10 === 0) return candidate.join('');
  }
  throw new Error('unreachable: a Luhn check digit always exists');
}
