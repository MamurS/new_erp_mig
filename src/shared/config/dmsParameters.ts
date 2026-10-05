/*
 * Business parameters of the DMS in one place: value, unit, description and allowed range.
 * The values below are demo values; MIG confirms or changes them on /staff/admin/parameters
 * (an admin proposes, a second admin or underwriter confirms). The server keeps the current
 * values; code never hardcodes them: the mock reads `param()` (src/mocks/params.ts), screens
 * read `useDmsParam()` or get computed values from the API.
 */
import type { DmsParamKey, DmsParamValues, ProgramCode } from '@/shared/types';
import { formatMoney, formatNumber } from '@/shared/lib/format';
import { defineLabels, msg, t, tKey } from '@/i18n';

export type DmsParamUnit = 'uzs' | 'percent' | 'days' | 'workdays' | 'minutes' | 'count' | 'ratio' | 'option';

export const DMS_PARAM_GROUPS = ['guarantee', 'assistance', 'clinics', 'limits', 'kp', 'tariff', 'contracts', 'claims', 'security'] as const;
export type DmsParamGroup = (typeof DMS_PARAM_GROUPS)[number];
/** Section titles of the parameters page, in the current language. */
export const DMS_PARAM_GROUP_LABEL = defineLabels<DmsParamGroup>('params.group', DMS_PARAM_GROUPS);

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
  /** Unit `option`: labels of the choices, the value is the index. */
  options?: readonly string[];
}

/** A parameter without its texts; `options`: the number of choices. */
type DmsParamSpec = Omit<DmsParameterDef, 'label' | 'description' | 'options'> & { options?: number };

const SPECS: Record<DmsParamKey, DmsParamSpec> = {
  guaranteeDualApprovalThreshold: {
    group: 'guarantee',
    unit: 'uzs',
    defaultValue: 20_000_000,
    min: 1_000_000,
    max: 1_000_000_000,
    integer: true,
    audience: 'staff',
  },
  guaranteeValidityDays: {
    group: 'guarantee',
    unit: 'days',
    defaultValue: 30,
    min: 1,
    max: 180,
    integer: true,
    audience: 'all',
  },
  assistanceGuaranteeAuthority: {
    group: 'assistance',
    unit: 'uzs',
    defaultValue: 10_000_000,
    min: 0,
    max: 1_000_000_000,
    integer: true,
    audience: 'staff',
  },
  qaSampleShare: {
    group: 'assistance',
    unit: 'percent',
    defaultValue: 0.05,
    min: 0.01,
    max: 0.5,
    integer: false,
    audience: 'staff',
  },
  rebillReviewWorkdays: {
    group: 'assistance',
    unit: 'workdays',
    defaultValue: 10,
    min: 1,
    max: 30,
    integer: true,
    audience: 'staff',
  },
  subRegistryReviewDays: {
    group: 'assistance',
    unit: 'days',
    defaultValue: 5,
    min: 1,
    max: 30,
    integer: true,
    audience: 'staff',
  },
  clinicResponseMinutes: {
    group: 'clinics',
    unit: 'minutes',
    defaultValue: 120,
    min: 15,
    max: 1440,
    integer: true,
    audience: 'all',
  },
  limitLowShare: {
    group: 'limits',
    unit: 'percent',
    defaultValue: 0.2,
    min: 0.05,
    max: 0.5,
    integer: false,
    audience: 'all',
  },
  lossRatioWarn: {
    group: 'limits',
    unit: 'percent',
    defaultValue: 0.8,
    min: 0.3,
    max: 1.5,
    integer: false,
    audience: 'all',
  },
  kpValidityDays: {
    group: 'kp',
    unit: 'days',
    defaultValue: 30,
    min: 1,
    max: 90,
    integer: true,
    audience: 'staff',
  },
  loginMaxAttempts: {
    group: 'security',
    unit: 'count',
    defaultValue: 5,
    min: 3,
    max: 20,
    integer: true,
    audience: 'staff',
  },
  loginWindowMinutes: {
    group: 'security',
    unit: 'minutes',
    defaultValue: 10,
    min: 1,
    max: 60,
    integer: true,
    audience: 'staff',
  },
  loginLockMinutes: {
    group: 'security',
    unit: 'minutes',
    defaultValue: 5,
    min: 1,
    max: 120,
    integer: true,
    audience: 'staff',
  },
  pinflChecksPerHour: {
    group: 'security',
    unit: 'count',
    defaultValue: 30,
    min: 5,
    max: 500,
    integer: true,
    audience: 'all',
  },
  pinflFailsBeforeLock: {
    group: 'security',
    unit: 'count',
    defaultValue: 10,
    min: 3,
    max: 50,
    integer: true,
    audience: 'all',
  },
  pinflLockMinutes: {
    group: 'security',
    unit: 'minutes',
    defaultValue: 15,
    min: 1,
    max: 240,
    integer: true,
    audience: 'all',
  },
  tariffBaseBasic: {
    group: 'tariff',
    unit: 'uzs',
    defaultValue: 2_500_000,
    min: 100_000,
    max: 100_000_000,
    integer: true,
    audience: 'staff',
  },
  tariffBaseStandard: {
    group: 'tariff',
    unit: 'uzs',
    defaultValue: 3_800_000,
    min: 100_000,
    max: 100_000_000,
    integer: true,
    audience: 'staff',
  },
  tariffBaseStandardPlus: {
    group: 'tariff',
    unit: 'uzs',
    defaultValue: 5_200_000,
    min: 100_000,
    max: 100_000_000,
    integer: true,
    audience: 'staff',
  },
  tariffBasePremium: {
    group: 'tariff',
    unit: 'uzs',
    defaultValue: 7_000_000,
    min: 100_000,
    max: 100_000_000,
    integer: true,
    audience: 'staff',
  },
  tariffCoef0to17: {
    group: 'tariff',
    unit: 'ratio',
    defaultValue: 0.6,
    min: 0.1,
    max: 5,
    integer: false,
    audience: 'staff',
  },
  tariffCoef18to29: {
    group: 'tariff',
    unit: 'ratio',
    defaultValue: 0.85,
    min: 0.1,
    max: 5,
    integer: false,
    audience: 'staff',
  },
  tariffCoef30to39: {
    group: 'tariff',
    unit: 'ratio',
    defaultValue: 1,
    min: 0.1,
    max: 5,
    integer: false,
    audience: 'staff',
  },
  tariffCoef40to49: {
    group: 'tariff',
    unit: 'ratio',
    defaultValue: 1.15,
    min: 0.1,
    max: 5,
    integer: false,
    audience: 'staff',
  },
  tariffCoef50to59: {
    group: 'tariff',
    unit: 'ratio',
    defaultValue: 1.4,
    min: 0.1,
    max: 5,
    integer: false,
    audience: 'staff',
  },
  tariffCoef60plus: {
    group: 'tariff',
    unit: 'ratio',
    defaultValue: 1.8,
    min: 0.1,
    max: 5,
    integer: false,
    audience: 'staff',
  },
  groupDiscountFrom: {
    group: 'tariff',
    unit: 'count',
    defaultValue: 100,
    min: 2,
    max: 100_000,
    integer: true,
    audience: 'staff',
  },
  groupDiscountShare: {
    group: 'tariff',
    unit: 'percent',
    defaultValue: 0.05,
    min: 0,
    max: 0.5,
    integer: false,
    audience: 'staff',
  },
  paperOriginalReminderDays: {
    group: 'contracts',
    unit: 'days',
    defaultValue: 30,
    min: 1,
    max: 365,
    integer: true,
    audience: 'staff',
  },
  overdueBlocksService: {
    group: 'contracts',
    unit: 'option',
    defaultValue: 0,
    min: 0,
    max: 1,
    integer: true,
    audience: 'staff',
    options: 2,
  },
  endorsementPeriodicity: {
    group: 'contracts',
    unit: 'option',
    defaultValue: 0,
    min: 0,
    max: 1,
    integer: true,
    audience: 'all',
    options: 2,
  },
  refundRule: {
    group: 'contracts',
    unit: 'option',
    defaultValue: 1,
    min: 0,
    max: 2,
    integer: true,
    audience: 'all',
    options: 3,
  },
  coverageStartRule: {
    group: 'contracts',
    unit: 'option',
    defaultValue: 0,
    min: 0,
    max: 1,
    integer: true,
    audience: 'all',
    options: 2,
  },
  renewalLeadDays: {
    group: 'contracts',
    unit: 'days',
    defaultValue: 60,
    min: 7,
    max: 180,
    integer: true,
    audience: 'staff',
  },
  leadIdleDays: {
    group: 'kp',
    unit: 'days',
    defaultValue: 7,
    min: 1,
    max: 90,
    integer: true,
    audience: 'staff',
  },
  kpNoAnswerDays: {
    group: 'kp',
    unit: 'days',
    defaultValue: 5,
    min: 1,
    max: 60,
    integer: true,
    audience: 'staff',
  },
  fraudMaxClaimsPerMonth: {
    group: 'claims',
    unit: 'count',
    defaultValue: 4,
    min: 1,
    max: 100,
    integer: true,
    audience: 'staff',
  },
  fraudPriceExcessShare: {
    group: 'claims',
    unit: 'percent',
    defaultValue: 0.3,
    min: 0.05,
    max: 5,
    integer: false,
    audience: 'staff',
  },
  fraudDaysBeforeExclusion: {
    group: 'claims',
    unit: 'days',
    defaultValue: 14,
    min: 1,
    max: 90,
    integer: true,
    audience: 'staff',
  },
};

export const DMS_PARAM_KEYS = Object.keys(SPECS) as DmsParamKey[];

/** Label, description and option labels are read in the current language (params.<key>.*). */
function describe(key: DmsParamKey, { options, ...spec }: DmsParamSpec): DmsParameterDef {
  const def = { ...spec } as DmsParameterDef;
  Object.defineProperties(def, {
    label: { enumerable: true, get: () => tKey(`params.${key}.label`) },
    description: { enumerable: true, get: () => tKey(`params.${key}.description`) },
  });
  if (options) {
    Object.defineProperty(def, 'options', {
      enumerable: true,
      get: () => Array.from({ length: options }, (_, i) => tKey(`params.${key}.option${i}`)),
    });
  }
  return def;
}

export const DMS_PARAMETERS = Object.fromEntries(DMS_PARAM_KEYS.map((k) => [k, describe(k, SPECS[k])])) as Record<DmsParamKey, DmsParameterDef>;

/** Demo values of all parameters (the seed state). */
export const DMS_DEFAULTS: DmsParamValues = Object.fromEntries(DMS_PARAM_KEYS.map((k) => [k, DMS_PARAMETERS[k].defaultValue])) as DmsParamValues;

export function isDmsParamKey(key: string): key is DmsParamKey {
  return Object.prototype.hasOwnProperty.call(DMS_PARAMETERS, key);
}

/** Range and type check of a new value; `null` when valid. The same rule on the form and on the server. */
export function dmsParamError(key: DmsParamKey, value: number): string | null {
  const def = DMS_PARAMETERS[key];
  if (!Number.isFinite(value)) return msg('v.numberRequired');
  if (def.integer && !Number.isInteger(value)) return msg('params.error.integer');
  if (value < def.min || value > def.max) return msg('params.error.range', { min: formatDmsParam(key, def.min), max: formatDmsParam(key, def.max) });
  return null;
}

const UNIT_SUFFIX: Record<DmsParamUnit, () => string> = {
  uzs: () => t('fmt.currency'),
  percent: () => '%',
  days: () => t('params.unit.days'),
  workdays: () => t('params.unit.workdays'),
  minutes: () => t('params.unit.minutes'),
  count: () => '',
  ratio: () => '',
  option: () => '',
};

export function dmsUnitLabel(unit: DmsParamUnit): string {
  return UNIT_SUFFIX[unit]();
}

/** Human value with its unit: `20 000 000 UZS`, `5%`, `10 раб. дн.`. */
export function formatDmsParam(key: DmsParamKey, value: number): string {
  const { unit, options } = DMS_PARAMETERS[key];
  if (unit === 'option') return options?.[value] ?? String(value);
  if (unit === 'ratio') return `×${String(value).replace('.', ',')}`;
  if (unit === 'percent') return `${String(Math.round(value * 1000) / 10).replace('.', ',')}%`;
  if (unit === 'uzs') return formatMoney(value);
  const suffix = UNIT_SUFFIX[unit]();
  return suffix ? `${formatNumber(value)}\u00a0${suffix}` : formatNumber(value);
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

/** Parameter with the base annual rate of each program (quotes, LIFECYCLE_SPEC §5). */
export const TARIFF_BASE_KEY: Record<ProgramCode, DmsParamKey> = {
  basic: 'tariffBaseBasic',
  standard: 'tariffBaseStandard',
  standard_plus: 'tariffBaseStandardPlus',
  premium: 'tariffBasePremium',
};
