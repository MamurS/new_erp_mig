import { describe, expect, it } from 'vitest';
import { ru } from './ru';
import { uz } from './uz';
import { translate } from './index';

describe('i18n', () => {
  it('uz has every ru key and no empty strings', () => {
    expect(Object.keys(uz).sort()).toEqual(Object.keys(ru).sort());
    for (const v of Object.values(uz)) expect(v.trim()).not.toBe('');
  });
  it('interpolates', () => {
    expect(translate('ru', 'home.greeting', { name: 'Азиз' })).toBe('Добрый день, Азиз!');
    expect(translate('uz', 'home.greeting', { name: 'Aziz' })).toBe('Salom, Aziz!');
  });
});
