import type { errors as Ru } from '../ru/errors';
import type { Translation } from '../types';

export const errors: Translation<typeof Ru> = {
  'errors.unauthorized': 'Seans tugadi, qaytadan kiring',
  'errors.forbidden': 'Bu amal uchun huquqlar yetarli emas',
  'errors.notFound': 'Topilmadi',
  'errors.validation': 'Maydonlar toʻgʻri toʻldirilganini tekshiring',
  'errors.conflict': 'Joriy holatda bu amalni bajarib boʻlmaydi',
  'errors.rateLimited': 'Urinishlar juda koʻp. Keyinroq qayta urining',
  'errors.server': 'Xizmat vaqtincha ishlamayapti. Qayta urining',
  'errors.internal': 'Serverning ichki xatosi',
  'errors.offline': 'Server bilan aloqa yoʻq. Internetni tekshirib, qayta urining',
  'errors.badResponse': 'Server kutilmagan javob qaytardi. Keyinroq qayta urining',
  'errors.badJson': 'JSON notoʻgʻri',
  'errors.tooLarge': 'Soʻrov juda katta',
  'errors.csrf': 'Soʻrov rad etildi. Sahifani yangilang va qayta urinib koʻring',
  'errors.unknown': 'Nimadir notoʻgʻri ketdi. Qayta urining',
  'errors.docsUnavailable': 'Hujjatlar mavjud emas',
};
