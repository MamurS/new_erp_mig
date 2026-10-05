import type { coverage as Ru } from '../ru/coverage';
import type { Translation } from '../types';

export const coverage: Translation<typeof Ru> = {
  'coverage.note.unknownCode': '{code} xizmati katalogda topilmadi',
  'coverage.note.noRule': '«{name}» uchun qoplash jadvalida qoida yoʻq',
  'coverage.note.excluded': '«{name}» — dastur istisnosi',
  'coverage.note.waiting': 'Kutish davri {days} kun: qoplash {from} dan',
  'coverage.note.limitExhausted': 'Ushbu yordam turi boʻyicha limit tugagan',
  'coverage.note.subLimit': 'Kichik limit {limit}: undan ortigʻi qoplanmaydi',
  'coverage.note.partly': 'Limit qoldigʻi {remaining}: qisman qoplanadi',
  'coverage.note.policyInactive': 'Polis xizmat sanasida amal qilmaydi',
  'coverage.note.personInactive': 'Sugʻurtalangan shaxs xizmat sanasida qoplanmagan',
  'coverage.note.unrecognized': 'Xizmat aniqlanmadi',
};
