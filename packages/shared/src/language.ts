import type { Locale } from './domain.js';

/**
 * Tiny stop-word language detector for French and English. Good enough to tag an e-mail or check
 * the language of a generated draft (evals); not a general-purpose detector.
 */
const STOP_WORDS: Record<Locale, readonly string[]> = {
  fr: [
    'le',
    'la',
    'les',
    'des',
    'du',
    'de',
    'un',
    'une',
    'et',
    'est',
    'nous',
    'vous',
    'pour',
    'dans',
    'sur',
    'avec',
    'pas',
    'que',
    'qui',
    'notre',
    'votre',
    'au',
    'aux',
    'ce',
    'cette',
    'bonjour',
    'merci',
    'cordialement',
    'sinistre',
    'contrat',
  ],
};

export function languageScores(text: string): Record<Locale, number> {
  const words = text
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .split(/[^a-z']+/)
    .filter(Boolean);
  const scores = {} as Record<Locale, number>;
  for (const [locale, stopWords] of Object.entries(STOP_WORDS) as [Locale, readonly string[]][]) {
    const set = new Set(stopWords);
    scores[locale] = words.filter((word) => set.has(word)).length;
  }
  return scores;
}

/** The most likely language of `text`, or `fallback` when no stop word is found. */
export function detectLanguage(text: string, fallback: Locale = 'fr'): Locale {
  const scores = languageScores(text);
  let best: Locale = fallback;
  let bestScore = 0;
  for (const [locale, score] of Object.entries(scores) as [Locale, number][]) {
    if (score > bestScore) {
      best = locale;
      bestScore = score;
    }
  }
  return best;
}
