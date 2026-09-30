/*
 * Sandbox of the clinic cabinet (CLINIC_SPEC §4.8.6): the methods of the integration API with a
 * form of parameters, and the builder that turns the form values into a request.
 */
import { z } from 'zod';

export type SandboxParamKind = 'text' | 'uuid' | 'number' | 'date' | 'select' | 'json';

export interface SandboxParam {
  name: string;
  in: 'path' | 'query' | 'body';
  kind: SandboxParamKind;
  required?: boolean;
  options?: readonly string[];
  /** Initial value of the form field. */
  example?: string;
  hint?: string;
}

export interface SandboxMethod {
  id: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH';
  path: string;
  label: string;
  params: SandboxParam[];
}

const slotsExample = JSON.stringify([{ specialty: 'therapist', startsAt: '2026-10-02T09:00:00+05:00', durationMin: 30, doctorRef: 'dr-17' }], null, 2);
const linesExample = JSON.stringify([{ visitId: '<visitId>', serviceDate: '2026-09-30', serviceCode: 'TH-101', icd10: 'J06.9', quantity: 1, price: 180000 }], null, 2);

export const SANDBOX_METHODS: SandboxMethod[] = [
  {
    id: 'coverage',
    method: 'POST',
    path: '/coverage/check',
    label: 'Проверить пациента',
    params: [
      { name: 'qrToken', in: 'body', kind: 'text', hint: 'Код из приложения (XXXX-XXXX) или строка QR — либо полис и ПИНФЛ ниже' },
      { name: 'policyNumber', in: 'body', kind: 'text' },
      { name: 'pinfl', in: 'body', kind: 'text' },
    ],
  },
  { id: 'visit', method: 'GET', path: '/visits/{visitId}', label: 'Визит', params: [{ name: 'visitId', in: 'path', kind: 'uuid', required: true }] },
  {
    id: 'appointments',
    method: 'GET',
    path: '/appointments',
    label: 'Записи',
    params: [
      { name: 'status', in: 'query', kind: 'select', options: ['', 'requested', 'confirmed', 'declined', 'completed', 'cancelled'], example: 'requested' },
      { name: 'from', in: 'query', kind: 'date' },
      { name: 'to', in: 'query', kind: 'date' },
      { name: 'cursor', in: 'query', kind: 'text' },
      { name: 'limit', in: 'query', kind: 'number', example: '20' },
    ],
  },
  { id: 'confirm', method: 'POST', path: '/appointments/{id}/confirm', label: 'Подтвердить запись', params: [{ name: 'id', in: 'path', kind: 'uuid', required: true }] },
  {
    id: 'reschedule',
    method: 'POST',
    path: '/appointments/{id}/reschedule',
    label: 'Предложить другое время',
    params: [
      { name: 'id', in: 'path', kind: 'uuid', required: true },
      { name: 'startsAt', in: 'body', kind: 'text', required: true, example: '2026-10-02T10:30:00+05:00' },
    ],
  },
  {
    id: 'decline',
    method: 'POST',
    path: '/appointments/{id}/decline',
    label: 'Отклонить запись',
    params: [
      { name: 'id', in: 'path', kind: 'uuid', required: true },
      { name: 'reason', in: 'body', kind: 'text', required: true, example: 'Врач в отпуске' },
    ],
  },
  { id: 'slots', method: 'PUT', path: '/slots', label: 'Заменить слоты', params: [{ name: 'slots', in: 'body', kind: 'json', required: true, example: slotsExample }] },
  {
    id: 'guarantee-create',
    method: 'POST',
    path: '/guarantees',
    label: 'Запросить ГП',
    params: [
      { name: 'visitId', in: 'body', kind: 'uuid', required: true },
      { name: 'serviceCode', in: 'body', kind: 'text', required: true, example: 'DG-310' },
      { name: 'icd10', in: 'body', kind: 'text', required: true, example: 'G43.9' },
      { name: 'estimatedCost', in: 'body', kind: 'number', required: true, example: '1800000' },
      { name: 'comment', in: 'body', kind: 'text' },
    ],
  },
  { id: 'guarantee', method: 'GET', path: '/guarantees/{id}', label: 'Гарантийное письмо', params: [{ name: 'id', in: 'path', kind: 'uuid', required: true }] },
  {
    id: 'registry-create',
    method: 'POST',
    path: '/registries',
    label: 'Отправить реестр',
    params: [
      { name: 'period', in: 'body', kind: 'text', required: true, example: '2026-09' },
      { name: 'lines', in: 'body', kind: 'json', required: true, example: linesExample },
    ],
  },
  { id: 'registry', method: 'GET', path: '/registries/{id}', label: 'Реестр', params: [{ name: 'id', in: 'path', kind: 'uuid', required: true }] },
  {
    id: 'dispute',
    method: 'POST',
    path: '/registries/{id}/lines/{lineId}/dispute',
    label: 'Оспорить строку реестра',
    params: [
      { name: 'id', in: 'path', kind: 'uuid', required: true },
      { name: 'lineId', in: 'path', kind: 'uuid', required: true },
      { name: 'comment', in: 'body', kind: 'text', required: true },
    ],
  },
  {
    id: 'payments',
    method: 'GET',
    path: '/payments',
    label: 'Оплаты',
    params: [
      { name: 'period', in: 'query', kind: 'text' },
      { name: 'cursor', in: 'query', kind: 'text' },
      { name: 'limit', in: 'query', kind: 'number' },
    ],
  },
];

/** Methods of the assistance section (ASSISTANCE_SPEC §8). */
export const ASSIST_SANDBOX_METHODS: SandboxMethod[] = [
  {
    id: 'roster',
    method: 'GET',
    path: '/assistance/roster',
    label: 'Список застрахованных',
    params: [
      { name: 'updatedSince', in: 'query', kind: 'text', hint: 'ISO 8601, например 2026-09-01T00:00:00+05:00' },
      { name: 'cursor', in: 'query', kind: 'text' },
      { name: 'limit', in: 'query', kind: 'number', example: '20' },
    ],
  },
  { id: 'limits', method: 'GET', path: '/assistance/insured/{id}/limits', label: 'Лимиты застрахованного', params: [{ name: 'id', in: 'path', kind: 'uuid', required: true }] },
  {
    id: 'case-create',
    method: 'POST',
    path: '/assistance/cases',
    label: 'Создать обращение',
    params: [
      { name: 'insuredId', in: 'body', kind: 'uuid', required: true },
      { name: 'type', in: 'body', kind: 'select', options: ['appointment', 'consultation', 'guarantee', 'complaint', 'emergency'], example: 'consultation', required: true },
      { name: 'description', in: 'body', kind: 'text', required: true, example: 'Вопрос о покрытии анализов' },
    ],
  },
  {
    id: 'case-update',
    method: 'PATCH',
    path: '/assistance/cases/{id}',
    label: 'Изменить обращение',
    params: [
      { name: 'id', in: 'path', kind: 'uuid', required: true },
      { name: 'status', in: 'body', kind: 'select', options: ['open', 'in_progress', 'waiting', 'resolved'], example: 'in_progress', required: true },
      { name: 'resolution', in: 'body', kind: 'text' },
    ],
  },
  {
    id: 'assist-appointments',
    method: 'GET',
    path: '/assistance/appointments',
    label: 'Записи застрахованных',
    params: [
      { name: 'status', in: 'query', kind: 'select', options: ['', 'requested', 'confirmed', 'declined', 'completed', 'cancelled'], example: 'requested' },
      { name: 'limit', in: 'query', kind: 'number', example: '20' },
    ],
  },
  {
    id: 'assist-guarantees',
    method: 'GET',
    path: '/assistance/guarantees',
    label: 'Гарантийные письма',
    params: [{ name: 'status', in: 'query', kind: 'select', options: ['', 'requested', 'approved', 'rejected', 'info_requested'], example: 'requested' }],
  },
  {
    id: 'guarantee-decide',
    method: 'POST',
    path: '/assistance/guarantees/{id}/decide',
    label: 'Решение по ГП',
    params: [
      { name: 'id', in: 'path', kind: 'uuid', required: true },
      { name: 'decision', in: 'body', kind: 'select', options: ['approve', 'reject', 'escalate'], example: 'approve', required: true },
      { name: 'amount', in: 'body', kind: 'number' },
      { name: 'validUntil', in: 'body', kind: 'date' },
      { name: 'reason', in: 'body', kind: 'text' },
    ],
  },
  {
    id: 'assist-registries',
    method: 'GET',
    path: '/assistance/registries',
    label: 'Подреестры клиник',
    params: [{ name: 'status', in: 'query', kind: 'select', options: ['', 'submitted', 'in_review', 'partially_accepted', 'accepted', 'paid'] }],
  },
  {
    id: 'line-decide',
    method: 'POST',
    path: '/assistance/registries/{id}/lines/{lineId}/decide',
    label: 'Решение по строке реестра',
    params: [
      { name: 'id', in: 'path', kind: 'uuid', required: true },
      { name: 'lineId', in: 'path', kind: 'uuid', required: true },
      { name: 'decision', in: 'body', kind: 'select', options: ['accept', 'reject'], example: 'accept', required: true },
      { name: 'reason', in: 'body', kind: 'text' },
    ],
  },
  {
    id: 'clinic-payment',
    method: 'POST',
    path: '/assistance/registries/{id}/payments',
    label: 'Оплата клинике',
    params: [
      { name: 'id', in: 'path', kind: 'uuid', required: true },
      { name: 'lineIds', in: 'body', kind: 'json', required: true, example: '["<lineId>"]' },
      { name: 'paidAt', in: 'body', kind: 'date', required: true },
      { name: 'amount', in: 'body', kind: 'number', required: true },
      { name: 'paymentOrderNumber', in: 'body', kind: 'text', required: true, example: 'ПП-10452' },
    ],
  },
  { id: 'rebill-create', method: 'POST', path: '/assistance/rebills', label: 'Выставить счёт МИГ', params: [{ name: 'period', in: 'body', kind: 'text', required: true, example: '2026-09' }] },
  { id: 'rebill', method: 'GET', path: '/assistance/rebills/{id}', label: 'Счёт МИГ', params: [{ name: 'id', in: 'path', kind: 'uuid', required: true }] },
  {
    id: 'rebill-dispute',
    method: 'POST',
    path: '/assistance/rebills/{id}/lines/{lineId}/dispute',
    label: 'Оспорить строку счёта',
    params: [
      { name: 'id', in: 'path', kind: 'uuid', required: true },
      { name: 'lineId', in: 'path', kind: 'uuid', required: true },
      { name: 'comment', in: 'body', kind: 'text', required: true },
    ],
  },
];

export function sandboxDefaults(m: SandboxMethod): Record<string, string> {
  return Object.fromEntries(m.params.map((p) => [p.name, p.example ?? '']));
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const valueSchema = z.string().max(50_000, 'Слишком длинное значение').transform((s) => s.trim());

export type SandboxRequest = { ok: true; path: string; body?: Record<string, unknown> } | { ok: false; errors: Record<string, string> };

/**
 * Validates the form and builds the request. Empty optional fields are left out; the server
 * checks the rest against its own schemas (the sandbox only catches obvious typos).
 */
export function buildSandboxRequest(m: SandboxMethod, values: Record<string, string>): SandboxRequest {
  const errors: Record<string, string> = {};
  let path = m.path;
  const query = new URLSearchParams();
  const body: Record<string, unknown> = {};
  for (const p of m.params) {
    const parsed = valueSchema.safeParse(values[p.name] ?? '');
    if (!parsed.success) {
      errors[p.name] = parsed.error.issues[0]?.message ?? 'Ошибка';
      continue;
    }
    const raw = parsed.data;
    if (!raw) {
      if (p.required) errors[p.name] = 'Обязательный параметр';
      continue;
    }
    let value: unknown = raw;
    if (p.kind === 'uuid' && !UUID.test(raw)) errors[p.name] = 'Нужен UUID';
    else if (p.kind === 'number') {
      const n = Number(raw.replace(/\s/g, ''));
      if (!Number.isFinite(n)) errors[p.name] = 'Нужно число';
      value = n;
    } else if (p.kind === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(raw)) errors[p.name] = 'Дата ГГГГ-ММ-ДД';
    else if (p.kind === 'select' && p.options && !p.options.includes(raw)) errors[p.name] = 'Выберите значение из списка';
    else if (p.kind === 'json') {
      try {
        value = JSON.parse(raw) as unknown;
      } catch {
        errors[p.name] = 'Некорректный JSON';
      }
    }
    if (errors[p.name]) continue;
    if (p.in === 'path') path = path.replace(`{${p.name}}`, encodeURIComponent(raw));
    else if (p.in === 'query') query.set(p.name, raw);
    else body[p.name] = value;
  }
  if (Object.keys(errors).length) return { ok: false, errors };
  const qs = query.toString();
  return { ok: true, path: qs ? `${path}?${qs}` : path, ...(m.method === 'GET' ? {} : { body }) };
}
