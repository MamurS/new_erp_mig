/*
 * Business parameters of the DMS in one place: value, unit, description and allowed range.
 * The values below are demo values; MIG confirms or changes them on /staff/admin/parameters
 * (an admin proposes, a second admin or underwriter confirms). The server keeps the current
 * values; code never hardcodes them: the mock reads `param()` (src/mocks/params.ts), screens
 * read `useDmsParam()` or get computed values from the API.
 */
import type { DmsParamKey, DmsParamValues } from '@/shared/types';
import { formatMoney, formatNumber } from '@/shared/lib/format';

export type DmsParamUnit = 'uzs' | 'percent' | 'days' | 'workdays' | 'minutes' | 'count';

export type DmsParamGroup = 'Гарантийные письма' | 'Ассистанс' | 'Клиники' | 'Лимиты и убыточность' | 'КП' | 'Безопасность';

export interface DmsParameterDef {
  label: string;
  description: string;
  group: DmsParamGroup;
  unit: DmsParamUnit;
  /** Demo value from the seed. Percent parameters are stored as a share: 0.05 = 5%. */
  defaultValue: number;
  min: number;
  max: number;
  integer: boolean;
  /** `all`: also readable by HR, clinics, assistances and the insured app; `staff`: MIG staff only. */
  audience: 'staff' | 'all';
}

export const DMS_PARAMETERS: Record<DmsParamKey, DmsParameterDef> = {
  guaranteeDualApprovalThreshold: {
    label: 'Порог двух подписей на ГП',
    description: 'Гарантийное письмо на сумму выше порога одобряют два разных врача-эксперта МИГ.',
    group: 'Гарантийные письма',
    unit: 'uzs',
    defaultValue: 20_000_000,
    min: 1_000_000,
    max: 1_000_000_000,
    integer: true,
    audience: 'staff',
  },
  guaranteeValidityDays: {
    label: 'Срок действия ГП по умолчанию',
    description: 'Подставляется в поле «Действует до» при одобрении письма; врач может изменить дату.',
    group: 'Гарантийные письма',
    unit: 'days',
    defaultValue: 30,
    min: 1,
    max: 180,
    integer: true,
    audience: 'all',
  },
  assistanceGuaranteeAuthority: {
    label: 'Полномочия ассистанса по ГП',
    description: 'Письма до этой суммы ассистанс одобряет сам, выше — эскалирует в МИГ. Действует, если в договоре ассистанса нет индивидуального значения.',
    group: 'Ассистанс',
    unit: 'uzs',
    defaultValue: 10_000_000,
    min: 0,
    max: 1_000_000_000,
    integer: true,
    audience: 'staff',
  },
  qaSampleShare: {
    label: 'Доля контрольной выборки',
    description: 'Доля решений ассистанса (ГП и принятые строки реестров), которые каждый месяц попадают на проверку врачу-эксперту МИГ.',
    group: 'Ассистанс',
    unit: 'percent',
    defaultValue: 0.05,
    min: 0.01,
    max: 0.5,
    integer: false,
    audience: 'staff',
  },
  rebillReviewWorkdays: {
    label: 'Срок проверки счёта ассистанса',
    description: 'Сколько рабочих дней у куратора МИГ на проверку счёта ассистанса после отправки.',
    group: 'Ассистанс',
    unit: 'workdays',
    defaultValue: 10,
    min: 1,
    max: 30,
    integer: true,
    audience: 'staff',
  },
  subRegistryReviewDays: {
    label: 'Срок проверки подреестра',
    description: 'Сколько календарных дней у ассистанса на проверку своих строк реестра клиники после отправки.',
    group: 'Ассистанс',
    unit: 'days',
    defaultValue: 5,
    min: 1,
    max: 30,
    integer: true,
    audience: 'staff',
  },
  clinicResponseMinutes: {
    label: 'Срок ответа клиники на запись',
    description: 'За сколько минут клиника должна ответить на заявку; дальше заявка эскалируется ассистансу или МИГ. Действует, если у клиники нет индивидуального норматива.',
    group: 'Клиники',
    unit: 'minutes',
    defaultValue: 120,
    min: 15,
    max: 1440,
    integer: true,
    audience: 'all',
  },
  limitLowShare: {
    label: 'Порог «лимит на исходе»',
    description: 'Лимит считается на исходе, когда остаток не больше этой доли. Предупреждения в приложении, у клиники, в HR-кабинете и у сотрудников МИГ.',
    group: 'Лимиты и убыточность',
    unit: 'percent',
    defaultValue: 0.2,
    min: 0.05,
    max: 0.5,
    integer: false,
    audience: 'all',
  },
  lossRatioWarn: {
    label: 'Порог высокой убыточности',
    description: 'Клиенты и ассистансы с убыточностью от этого значения отмечаются на рабочем столе, в списках и отчётах.',
    group: 'Лимиты и убыточность',
    unit: 'percent',
    defaultValue: 0.8,
    min: 0.3,
    max: 1.5,
    integer: false,
    audience: 'all',
  },
  kpValidityDays: {
    label: 'Срок действия КП по умолчанию',
    description: 'Подставляется в поле «Предложение действительно до» новой версии КП.',
    group: 'КП',
    unit: 'days',
    defaultValue: 30,
    min: 1,
    max: 90,
    integer: true,
    audience: 'staff',
  },
  loginMaxAttempts: {
    label: 'Попыток входа до блокировки',
    description: 'Сколько неудачных попыток входа за окно подсчёта допускается до временной блокировки.',
    group: 'Безопасность',
    unit: 'count',
    defaultValue: 5,
    min: 3,
    max: 20,
    integer: true,
    audience: 'staff',
  },
  loginWindowMinutes: {
    label: 'Окно подсчёта попыток входа',
    description: 'За какой период считаются неудачные попытки входа.',
    group: 'Безопасность',
    unit: 'minutes',
    defaultValue: 10,
    min: 1,
    max: 60,
    integer: true,
    audience: 'staff',
  },
  loginLockMinutes: {
    label: 'Блокировка входа',
    description: 'На сколько минут блокируется вход после превышения числа попыток.',
    group: 'Безопасность',
    unit: 'minutes',
    defaultValue: 5,
    min: 1,
    max: 120,
    integer: true,
    audience: 'staff',
  },
  pinflChecksPerHour: {
    label: 'Проверок по ПИНФЛ в час',
    description: 'Сколько проверок пациента по ПИНФЛ один пользователь клиники может сделать за час.',
    group: 'Безопасность',
    unit: 'count',
    defaultValue: 30,
    min: 5,
    max: 500,
    integer: true,
    audience: 'all',
  },
  pinflFailsBeforeLock: {
    label: 'Неудачных проверок по ПИНФЛ до блокировки',
    description: 'Сколько неудачных проверок подряд допускается до временной блокировки проверок у пользователя клиники.',
    group: 'Безопасность',
    unit: 'count',
    defaultValue: 10,
    min: 3,
    max: 50,
    integer: true,
    audience: 'all',
  },
  pinflLockMinutes: {
    label: 'Блокировка проверок по ПИНФЛ',
    description: 'На сколько минут блокируются проверки после серии неудачных.',
    group: 'Безопасность',
    unit: 'minutes',
    defaultValue: 15,
    min: 1,
    max: 240,
    integer: true,
    audience: 'all',
  },
};

export const DMS_PARAM_KEYS = Object.keys(DMS_PARAMETERS) as DmsParamKey[];

/** Demo values of all parameters (the seed state). */
export const DMS_DEFAULTS: DmsParamValues = Object.fromEntries(DMS_PARAM_KEYS.map((k) => [k, DMS_PARAMETERS[k].defaultValue])) as DmsParamValues;

export const DMS_PARAM_GROUPS: DmsParamGroup[] = ['Гарантийные письма', 'Ассистанс', 'Клиники', 'Лимиты и убыточность', 'КП', 'Безопасность'];

export function isDmsParamKey(key: string): key is DmsParamKey {
  return Object.prototype.hasOwnProperty.call(DMS_PARAMETERS, key);
}

/** Range and type check of a new value; `null` when valid. The same rule on the form and on the server. */
export function dmsParamError(key: DmsParamKey, value: number): string | null {
  const def = DMS_PARAMETERS[key];
  if (!Number.isFinite(value)) return 'Введите число';
  if (def.integer && !Number.isInteger(value)) return 'Нужно целое число';
  if (value < def.min || value > def.max) return `Допустимо от ${formatDmsParam(key, def.min)} до ${formatDmsParam(key, def.max)}`;
  return null;
}

const UNIT_SUFFIX: Record<DmsParamUnit, string> = { uzs: 'UZS', percent: '%', days: 'дн.', workdays: 'раб. дн.', minutes: 'мин', count: '' };

export function dmsUnitLabel(unit: DmsParamUnit): string {
  return UNIT_SUFFIX[unit];
}

/** Human value with its unit: `20 000 000 UZS`, `5%`, `10 раб. дн.`. */
export function formatDmsParam(key: DmsParamKey, value: number): string {
  const { unit } = DMS_PARAMETERS[key];
  if (unit === 'percent') return `${String(Math.round(value * 1000) / 10).replace('.', ',')}%`;
  if (unit === 'uzs') return formatMoney(value);
  return UNIT_SUFFIX[unit] ? `${formatNumber(value)}\u00a0${UNIT_SUFFIX[unit]}` : formatNumber(value);
}

/** The editor works in display units: percents as 5 (not 0.05). */
export function toDisplayValue(key: DmsParamKey, value: number): number {
  return DMS_PARAMETERS[key].unit === 'percent' ? Math.round(value * 1000) / 10 : value;
}

export function fromDisplayValue(key: DmsParamKey, value: number): number {
  return DMS_PARAMETERS[key].unit === 'percent' ? Math.round(value * 10) / 1000 : value;
}

/** Share of the limit used from which it counts as running low: 1 − `limitLowShare`. */
export function limitWarnRatio(values: Pick<DmsParamValues, 'limitLowShare'>): number {
  return 1 - values.limitLowShare;
}
