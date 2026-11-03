import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import en from '../src/locales/en.js';
import de from '../src/locales/de.js';
import cs from '../src/locales/cs.js';

const sources = ['src/index.html', 'src/js/app.js'].map((f) => fs.readFileSync(f, 'utf8')).join('\n');
const used = [...sources.matchAll(/data-i18n(?:-[a-z-]+)?="([a-z_A-Z]+)"|\bt\('([a-z_A-Z]+)'/g)].map((m) => m[1] ?? m[2]);

describe('translations', () => {
  it.each([['de', de], ['cs', cs]])('%s has every English key', (_lang, strings) => {
    expect(Object.keys(en).filter((k) => !(k in strings))).toEqual([]);
  });
  it.each([['en', en], ['de', de], ['cs', cs]])('%s has every key used by the UI', (_lang, strings) => {
    expect([...new Set(used)].filter((k) => !(k in strings))).toEqual([]);
  });
  it('keeps placeholders intact in Czech', () => {
    for (const key of Object.keys(en)) {
      const vars = (s) => (s.match(/\{\w+\}/g) ?? []).sort();
      expect(vars(cs[key] ?? ''), key).toEqual(vars(en[key]));
    }
  });
});
