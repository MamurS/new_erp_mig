/*
 * Fake OCR of a receipt photo. Everything comes from the image bytes, so the same photo gives the same
 * receipt for anyone who sends it — like a real recognizer would read the same paper receipt. A real
 * backend reads the fiscal sign from the receipt and checks it by the tax service's QR (README).
 */
import type { ReceiptFiscal } from '@mig/contracts';
import type { RecognizeResult } from '@mig/contracts/dto';
import { chance, digits, hashString, int, mulberry32, pick } from './rng';
import { DAY, isoDay } from './time';

/** A stable INN of a point of sale by its name (seed and fake OCR agree). */
export function sellerInnOf(name: string): string {
  return String(200_000_000 + (hashString(name.trim().toLowerCase()) % 99_999_999));
}

/** Fiscal data for a receipt; about one photo in six has an unreadable fiscal sign. */
export function fakeFiscal(seed: number, providerName: string, date: string, amount: number): ReceiptFiscal {
  const rng = mulberry32(seed);
  const readable = !chance(rng, 0.15);
  const time = `${String(int(rng, 8, 21)).padStart(2, '0')}:${String(int(rng, 0, 59)).padStart(2, '0')}`;
  const number = `${int(rng, 1, 9)}${digits(rng, 11)}`;
  return {
    ...(readable ? { fiscalNumber: number } : {}),
    issuedAt: `${date}T${time}`,
    amount,
    sellerInn: sellerInnOf(providerName),
  };
}

/** `imageHash` is the SHA-256 of the uploaded (re-encoded) image. */
export function recognizeReceipt(imageHash: string, now = Date.now()): RecognizeResult {
  const seed = hashString(imageHash);
  const rng = mulberry32(seed);
  const providerName = pick(rng, [
    'Shifo Farm Dorixonasi',
    'Nur Dori Dorixonasi',
    'Salomat Plus Tibbiyot Markazi',
    'Madad Med Klinikasi',
  ]);
  // A pharmacy receipt mixes medicines with vitamins and cosmetics; a clinic one has services.
  const pool = providerName.endsWith('Dorixonasi')
    ? [
        pick(rng, ['Нурофен 200 мг', 'Амоксиклав 875 мг', 'Називин капли в нос', 'Смекта']),
        pick(rng, ['Парацетамол 500 мг', 'Но-шпа 40 мг', 'Лоратадин 10 мг']),
        pick(rng, ['Аквадетрим 10 мл', 'Витамин С шипучий', 'Компливит']),
        pick(rng, ['Крем для лица увлажняющий', 'Солнцезащитный крем SPF 50', 'Бальзам для губ']),
      ]
    : ['Приём терапевта', 'Общий анализ крови', pick(rng, ['ЭКГ с расшифровкой', 'УЗИ брюшной полости'])];
  const items = pool.map((name) => ({ name, amount: int(rng, 15, 120) * 1000 }));
  const amount = items.reduce((s, x) => s + x.amount, 0);
  const serviceDate = isoDay(now - int(rng, 0, 3) * DAY);
  return {
    providerName,
    amount,
    serviceDate,
    items,
    fiscal: fakeFiscal(seed + 1, providerName, serviceDate, amount),
  };
}
