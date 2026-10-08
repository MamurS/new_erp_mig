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
  'auth.totp.title': 'Ikkinchi omilni ulang',
  'auth.totp.subtitle': 'Birinchi kirish: kirish autentifikator ilovasidagi kod bilan himoyalanadi',
  'auth.totp.step1': '1. QR-kodni autentifikator ilovasi (Google Authenticator, Microsoft Authenticator yoki boshqasi) bilan skanerlang.',
  'auth.totp.manual': 'Skanerlab boʻlmayaptimi? Kalitni qoʻlda kiriting',
  'auth.totp.step2': '2. Ilova koʻrsatgan 6 xonali kodni kiriting.',
  'auth.totp.qrAlt': 'Autentifikator ilovasi uchun QR-kod',
  'auth.notice.otherTab': 'Siz boshqa vkladkada chiqdingiz',
  'auth.notice.idle': 'Faollik boʻlmagani sababli seans yakunlandi. Qaytadan kiring',
  'auth.idle.title': 'Hali shu yerdamisiz?',
  'auth.idle.description': 'Faollik boʻlmagani sababli seans tez orada yakunlanadi. Saqlanmagan maʼlumotlar yoʻqoladi.',
  'auth.idle.stay': 'Ishni davom ettirish',
};
