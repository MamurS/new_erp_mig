import type { auth as Ru } from '../ru/auth';
import type { Translation } from '../types';

export const auth: Translation<typeof Ru> = {
  'auth.card.tagline': 'ITS · xodimlar va mijozlar portali',
  'auth.login.title': 'Kirish',
  'auth.login.subtitle': 'MIG xodimlari va mijoz kompaniyalarning HR xodimlari uchun',
  'auth.login.password': 'Parol',
  'auth.login.submit': 'Kirish',
  'auth.otp.docTitle': 'Tasdiqlash kodi',
  'auth.otp.title': 'Ikkinchi omil',
  'auth.otp.subtitle': 'Autentifikator ilovasi yoki SMSdagi 6 xonali kodni kiriting',
  'auth.otp.footer': 'Kirish MFA bilan himoyalangan. Barcha kirishlar audit jurnaliga yoziladi.',
  'auth.otp.resendIn': 'Kodni {n} soniyadan keyin qayta yuborish mumkin',
  'auth.otp.resend': 'Kodni qayta yuborish',
  'auth.otp.resent': 'Kod qayta yuborildi',
  'auth.notice.otherTab': 'Siz boshqa vkladkada chiqdingiz',
  'auth.notice.idle': 'Faollik boʻlmagani sababli seans yakunlandi. Qaytadan kiring',
  'auth.idle.title': 'Hali shu yerdamisiz?',
  'auth.idle.description': 'Faollik boʻlmagani sababli seans tez orada yakunlanadi. Saqlanmagan maʼlumotlar yoʻqoladi.',
  'auth.idle.stay': 'Ishni davom ettirish',
};
