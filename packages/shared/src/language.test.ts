import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { detectLanguage } from './language.js';

describe('detectLanguage', () => {
  it('recognises French and English e-mails', () => {
    assert.equal(
      detectLanguage('Bonjour, une fuite au plafond a inondé le fournil cette nuit. Cordialement'),
      'fr',
    );
    assert.equal(
      detectLanguage('Hello, a pipe burst in our Lyon office last night. Repair quote attached.'),
      'en',
    );
  });

  it('falls back when no stop word is found', () => {
    assert.equal(detectLanguage('C-48213 / 2026', 'en'), 'en');
    assert.equal(detectLanguage(''), 'fr');
  });
});
