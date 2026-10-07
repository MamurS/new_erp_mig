import { describe, expect, it } from 'vitest';
import { isQuestion } from './question';

describe('«question or search» of the help field', () => {
  it('ru: a question word, «?» or more than five words', () => {
    for (const q of ['как разнести платёж от другой компании', 'где посмотреть лимиты', 'что делать если клиника не отвечает', 'можно ли продлить полис', 'почему отклонён убыток', 'когда приходит счёт', 'кто подписывает договор', 'ГП?', 'Как разнести платёж']) expect(isQuestion(q), q).toBe(true);
    expect(isQuestion('договор подписан но счёт не выставлен вовремя')).toBe(true);
  });
  it('uz-Latn: question words with or without the apostrophes', () => {
    for (const q of ['qanday qilib toʻlovni taqsimlash', 'qayerda limitlarni koʻrish', 'nima qilish kerak', 'kim imzolaydi', 'nega rad etildi', 'qachon hisob keladi', 'Qanday ishlaydi']) expect(isQuestion(q), q).toBe(true);
  });
  it('en: question words', () => {
    for (const q of ['how to allocate a payment', 'where are the limits', 'what is a guarantee letter', 'who signs the contract', 'why was the claim rejected', 'when is the invoice issued', 'can I extend a policy']) expect(isQuestion(q), q).toBe(true);
  });
  it('short searches start no answer', () => {
    for (const q of ['гп', 'ГП', 'STIR', 'гарантийное письмо', 'ручная разноска', 'kafolat xati', 'guarantee letter', 'E-IMZO', 'как', 'ab', '', '   ']) expect(isQuestion(q), q).toBe(false);
    // A question word only at the start, not inside another word.
    expect(isQuestion('какао')).toBe(false);
    expect(isQuestion('whose letter')).toBe(false);
    expect(isQuestion('договор что делать')).toBe(false);
  });
});
