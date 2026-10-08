import type { emptyPartner as Ru } from '../ru/emptyPartner';
import type { Translation } from '../types';

export const emptyPartner: Translation<typeof Ru> = {
  'emptyPartner.contact.mig': 'MIGga yozish',
  'emptyPartner.contact.chat': 'Bizga yozing',
  'emptyPartner.contact.subject': 'Hamkor kabineti boʻyicha savol',

  'emptyPartner.clinic.prices.title': 'Narxlar roʻyxati hali yoʻq',
  'emptyPartner.clinic.prices.why': 'Klinika narxlarini MIG klinikani ITS tarmogʻiga ulashda yuklaydi yoki uni sizning TAT integratsiya API orqali yuboradi.',
  'emptyPartner.clinic.prices.next': 'Masʼul: MIG {role}. Klinika ulangan boʻlsa-yu, narxlar boʻlmasa — MIGga yozing.',
  'emptyPartner.clinic.acts.title': 'Solishtirish dalolatnomalari hali yoʻq',
  'emptyPartner.clinic.acts.why': 'Solishtirish dalolatnomasi oylik reyestr boʻyicha MIG yoki assistans uni tekshirib, toʻlovni belgilagach tuziladi.',
  'emptyPartner.clinic.acts.next': 'Avval reyestrni yigʻib yuborish kerak — buni {role} bajaradi.',
  'emptyPartner.clinic.acts.open': 'Reyestrlarga oʻtish',

  'emptyPartner.clinic.registries.why': 'Oylik reyestr bemor tekshiruvidan keyin ochilgan tashriflardan yigʻiladi yoki CSV dan yuklanadi. Hali birorta reyestr yaratilmagan.',
  'emptyPartner.clinic.registries.next': 'Davrni tanlang va reyestrni tashriflardan yigʻing yoki shablon boʻyicha CSV yuklang — yuborilgach uni MIG yoki assistans tekshiradi. Masʼul: {role}.',
  'emptyPartner.clinic.registries.build': 'Reyestrni tashriflardan yigʻish',
  'emptyPartner.clinic.registries.template': 'CSV shablonini yuklab olish',

  'emptyPartner.clinic.gp.why': 'Kafolat xati xizmat kelishuvni talab qilganda tashrifdan soʻraladi. Hali soʻrovlar boʻlmagan.',
  'emptyPartner.clinic.gp.next': 'Bemorni tekshiring, tashrifni oching va xat soʻrang. Qarorni bemorning assistansi yoki MIG qabul qiladi.',
  'emptyPartner.clinic.gp.check': 'Bemorni tekshirishdan boshlash',

  'emptyPartner.keys.why': 'API kaliti {system}ni MIG API ga ulash uchun kerak. Hali birorta kalit yaratilmagan.',
  'emptyPartner.keys.next': 'Kalitni {role} yaratadi; maxfiy kalit bir marta koʻrsatiladi — uni darhol saqlang.',
  'emptyPartner.keys.create': 'Birinchi kalitni yaratish',
  'emptyPartner.webhooks.why': 'Manzil boʻlmaguncha MIG tizimingizga hodisalar haqida xabar bermaydi — u ular haqida faqat API soʻrovi orqali bilib oladi.',
  'emptyPartner.webhooks.next': 'Vebxuk manzilini {role} qoʻshadi.',
  'emptyPartner.webhooks.create': 'Manzilni koʻrsatish',
  'emptyPartner.webhooks.deliveriesWhy': 'Yetkazishlar kamida bitta vebxuk manzili qoʻshilgach, birinchi hodisadan keyin paydo boʻladi.',

  'emptyPartner.users.title': 'Hali foydalanuvchilar yoʻq',
  'emptyPartner.users.why': 'Xodimlar kabinetga faqat taklif orqali kiradi.',
  'emptyPartner.users.next': '{role} taklif qiladi: email va rolni koʻrsating — kirish havolasi pochtaga keladi.',
  'emptyPartner.users.invite': 'Birinchi xodimni taklif qilish',

  'emptyPartner.assist.lines.why': 'Hisob qatorlari davr uchun tekshirilgan klinika reyestrlari va MIG bilan shartnoma boʻyicha yigʻimlardan olinadi. Bu davrda ular yoʻq.',
  'emptyPartner.assist.lines.next': 'MIG bilan shartnoma shartlarini MIG {role}i sozlaydi; qatorlar yetishmasa — MIGga yozing.',
  'emptyPartner.assist.cases.why': 'Murojaatlar mijozlaringiz sugʻurtalanganlarining qoʻngʻiroqlari va chatlaridan, shuningdek klinikalar eskalatsiyalaridan yaratiladi.',
  'emptyPartner.assist.cases.next': 'Qoʻngʻiroqdan murojaat ochish uchun sugʻurtalanganni toping va «Yangi murojaat» ni bosing — buni {role} bajaradi.',
  'emptyPartner.assist.cases.find': 'Sugʻurtalanganni topish',
  'emptyPartner.assist.registries.why': 'Quyi reyestrlar sugʻurtalanganlaringizga xizmat koʻrsatgan klinikalar oylik reyestrni yuborganda keladi.',
  'emptyPartner.assist.registries.next': 'Reyestrni {role} yuboradi; uni tekshirib, toʻlovni {checker} belgilaydi.',
  'emptyPartner.assist.rebills.why': 'MIG uchun oylik hisob tekshirilgan va toʻlangan klinika reyestrlari hamda shartnoma boʻyicha yigʻimlardan tuziladi.',
  'emptyPartner.assist.rebills.next': 'Hisobni {role} tuzadi va yuboradi.',
  'emptyPartner.assist.rebills.build': 'Birinchi hisobni tuzish',
  'emptyPartner.assist.gp.why': 'Kafolat xatlarini klinikalar bemor tashrifidan yoki operator murojaatdan soʻraydi. Mijozlaringiz boʻyicha hali soʻrovlar boʻlmagan.',
  'emptyPartner.assist.gp.next': 'Qarorni vakolat doirasida {role} qabul qiladi; qolganlari MIGga oʻtadi.',

  'emptyPartner.app.certificate.why': 'Sertifikat ish beruvchingiz shartnomani imzolab, toʻlaganidan keyin polis bilan birga chiqariladi.',
  'emptyPartner.app.certificate.next': 'Masʼul — kompaniyangiz HR xodimi: sugʻurta boshlanish sanasini undan aniqlang.',
  'emptyPartner.app.claims.why': 'Qabul yoki dorilar uchun oʻzingiz toʻladingizmi? Chekni suratga oling — MIG pulni limit doirasida qaytaradi.',
  'emptyPartner.app.appointments.why': 'ITS tarmogʻidagi klinikaga yoziling — yozuv shu yerda paydo boʻladi, klinika esa vaqtni tasdiqlaydi.',
  'emptyPartner.app.family.why': 'Turmush oʻrtogʻi, bolalar yoki ota-onalar polisga ariza boʻyicha qoʻshiladi: uni shu yerda yuboring, kompaniyangiz HR xodimi koʻrib chiqadi.',
  'emptyPartner.app.family.request': 'Oila aʼzosini qoʻshish',
  'emptyPartner.app.familyRequests.why': 'Oila aʼzolari boʻyicha arizalaringiz va ularning holati shu yerda boʻladi.',
};
