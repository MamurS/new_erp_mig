/*
 * OpenAPI 3.1 document of the integration API, built from the zod schemas in ./schemas.ts
 * (the source of truth). Used only by scripts/build-openapi.mjs — the app never imports it.
 */
import { extendZodWithOpenApi, OpenAPIRegistry, OpenApiGeneratorV31 } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
import * as S from './schemas';

extendZodWithOpenApi(z);

const EXAMPLES = {
  visitId: '5b9f3c2e-8a41-4d0b-9f6e-2d7c1a4e8b10',
  id: '0c6e2f91-3b7d-4a55-8e2c-7f14d9a6b302',
};

export function buildOpenApi(): ReturnType<OpenApiGeneratorV31['generateDocument']> {
  const r = new OpenAPIRegistry();
  const bearer = r.registerComponent('securitySchemes', 'oauth2', {
    type: 'oauth2',
    flows: { clientCredentials: { tokenUrl: `${S.INTEGRATION_BASE}/oauth/token`, scopes: Object.fromEntries(S.INTEGRATION_SCOPES.map((s) => [s, s])) } },
  });

  const Problem = r.register('Problem', S.problem);
  const CoverageCheckResult = r.register('CoverageCheckResult', S.coverageCheckResult);
  const Visit = r.register('Visit', S.visit);
  const Appointment = r.register('Appointment', S.integrationAppointment);
  const AppointmentList = r.register('AppointmentList', S.appointmentList);
  const GuaranteeLetter = r.register('GuaranteeLetter', S.guaranteeLetter);
  const Registry = r.register('Registry', S.registry);
  const PaymentList = r.register('PaymentList', S.paymentList);
  r.register('WebhookEvent', S.webhookPayload);

  const errors = {
    400: { description: 'Некорректный запрос', content: { 'application/problem+json': { schema: Problem } } },
    401: { description: 'Нет токена, токен истёк или ключ отозван', content: { 'application/problem+json': { schema: Problem } } },
    403: { description: 'Нет области доступа или IP не в списке', content: { 'application/problem+json': { schema: Problem } } },
    404: { description: 'Не найдено (в том числе объект другой клиники или визит без действия)', content: { 'application/problem+json': { schema: Problem } } },
    422: { description: 'Ошибка проверки данных', content: { 'application/problem+json': { schema: Problem } } },
    429: { description: 'Превышен лимит 60 запросов в минуту (заголовок Retry-After)', content: { 'application/problem+json': { schema: Problem } } },
  };
  const json = <T extends z.ZodTypeAny>(schema: T, example?: z.input<T>) => ({ content: { 'application/json': { schema: example !== undefined ? schema.openapi({ example } as never) : schema } } });
  const idem = z.object({ 'Idempotency-Key': z.string().max(128).optional().openapi({ description: 'Повтор с тем же ключом в течение 24 часов вернёт первый ответ' }) });
  const secured = (scope: string) => [{ [bearer.name]: [scope] }];

  r.registerPath({
    method: 'post',
    path: '/oauth/token',
    summary: 'Получить токен доступа (OAuth 2.0 client credentials)',
    tags: ['Авторизация'],
    request: { body: { content: { 'application/x-www-form-urlencoded': { schema: S.tokenRequest }, 'application/json': { schema: S.tokenRequest.openapi({ example: { grant_type: 'client_credentials', client_id: 'mig_…', client_secret: '…' } }) } } } },
    responses: { 200: { description: 'Токен на 15 минут', ...json(S.tokenResponse) }, 400: errors[400], 401: errors[401] },
  });
  r.registerPath({
    method: 'post',
    path: '/coverage/check',
    summary: 'Проверить пациента и открыть визит на 24 часа',
    description: 'По одноразовому коду карты из приложения (QR, `MIG-DMS:{token}` или 8 символов) либо по номеру полиса и ПИНФЛ. Суммы лимитов и история обращений не возвращаются.',
    tags: ['Пациенты'],
    security: secured('coverage:check'),
    request: { headers: idem, body: json(S.coverageCheckRequest, { qrToken: 'K7P4-QX2M' }) },
    responses: { 200: { description: 'Покрытие по категориям', ...json(CoverageCheckResult) }, ...errors, 410: { description: 'Код устарел или уже использован', content: { 'application/problem+json': { schema: Problem } } } },
  });
  r.registerPath({
    method: 'get',
    path: '/visits/{visitId}',
    summary: 'Визит',
    tags: ['Пациенты'],
    security: secured('coverage:check'),
    request: { params: z.object({ visitId: z.string().uuid().openapi({ example: EXAMPLES.visitId }) }) },
    responses: { 200: { description: 'Визит', ...json(Visit) }, 401: errors[401], 404: errors[404] },
  });
  r.registerPath({
    method: 'get',
    path: '/appointments',
    summary: 'Записи в клинику',
    tags: ['Записи'],
    security: secured('appointments:read'),
    request: { query: S.appointmentQuery },
    responses: { 200: { description: 'Страница записей (курсорная пагинация)', ...json(AppointmentList) }, 401: errors[401], 403: errors[403], 422: errors[422] },
  });
  for (const [action, summary, body] of [
    ['confirm', 'Подтвердить запись', null],
    ['reschedule', 'Предложить другое время', S.rescheduleRequest.openapi({ example: { startsAt: '2026-10-02T10:30:00+05:00' } })],
    ['decline', 'Отклонить запись', S.declineRequest.openapi({ example: { reason: 'Врач в отпуске' } })],
  ] as const) {
    r.registerPath({
      method: 'post',
      path: `/appointments/{id}/${action}`,
      summary,
      tags: ['Записи'],
      security: secured('appointments:write'),
      request: { headers: idem, params: z.object({ id: z.string().uuid() }), ...(body ? { body: { content: { 'application/json': { schema: body } } } } : {}) },
      responses: { 200: { description: 'Запись', ...json(Appointment) }, 401: errors[401], 404: errors[404], 409: { description: 'На заявку уже ответили', content: { 'application/problem+json': { schema: Problem } } } },
    });
  }
  r.registerPath({
    method: 'put',
    path: '/slots',
    summary: 'Заменить слоты расписания на период',
    tags: ['Записи'],
    security: secured('slots:write'),
    request: { body: json(S.slotsPutRequest, { slots: [{ specialty: 'therapist', startsAt: '2026-10-02T09:00:00+05:00', durationMin: 30, doctorRef: 'dr-17' }] }) },
    responses: { 200: { description: 'Слоты заменены', ...json(S.slotsPutResult) }, 401: errors[401], 422: errors[422] },
  });
  r.registerPath({
    method: 'post',
    path: '/guarantees',
    summary: 'Запросить гарантийное письмо (только по визиту клиники)',
    tags: ['Гарантийные письма'],
    security: secured('guarantees:write'),
    request: { headers: idem, body: json(S.guaranteeCreateRequest, { visitId: EXAMPLES.visitId, serviceCode: 'DG-310', icd10: 'G43.9', estimatedCost: 1_800_000, comment: 'Мигрень, показано МРТ' }) },
    responses: { 201: { description: 'Запрос создан', ...json(GuaranteeLetter) }, ...errors },
  });
  r.registerPath({
    method: 'get',
    path: '/guarantees/{id}',
    summary: 'Гарантийное письмо',
    tags: ['Гарантийные письма'],
    security: secured('guarantees:read'),
    request: { params: z.object({ id: z.string().uuid() }) },
    responses: { 200: { description: 'Письмо', ...json(GuaranteeLetter) }, 401: errors[401], 404: errors[404] },
  });
  r.registerPath({
    method: 'post',
    path: '/guarantees/{id}/documents',
    summary: 'Догрузить документы (PDF, JPEG, PNG до 10 МБ)',
    tags: ['Гарантийные письма'],
    security: secured('guarantees:write'),
    request: {
      params: z.object({ id: z.string().uuid() }),
      body: { content: { 'multipart/form-data': { schema: z.object({ files: z.array(z.string().openapi({ format: 'binary' })), comment: z.string().max(1000).optional() }) } } },
    },
    responses: { 200: { description: 'Письмо', ...json(GuaranteeLetter) }, 401: errors[401], 404: errors[404], 422: errors[422] },
  });
  r.registerPath({
    method: 'post',
    path: '/registries',
    summary: 'Отправить реестр за месяц',
    description: 'Проверки: цена не выше прайса договора, номер ГП для услуг, которые его требуют, дата услуги в пределах полиса и визита. Ошибки по строкам — в `errors` (`lines[i]`).',
    tags: ['Реестры'],
    security: secured('registries:write'),
    request: {
      headers: idem,
      body: json(S.registryCreateRequest, { period: '2026-09', lines: [{ visitId: EXAMPLES.visitId, serviceDate: '2026-09-30', serviceCode: 'TH-101', icd10: 'J06.9', quantity: 1, price: 180000 }] }),
    },
    responses: { 201: { description: 'Реестр отправлен', ...json(Registry) }, ...errors },
  });
  r.registerPath({
    method: 'get',
    path: '/registries/{id}',
    summary: 'Реестр со статусами строк',
    tags: ['Реестры'],
    security: secured('registries:read'),
    request: { params: z.object({ id: z.string().uuid() }) },
    responses: { 200: { description: 'Реестр', ...json(Registry) }, 401: errors[401], 404: errors[404] },
  });
  r.registerPath({
    method: 'post',
    path: '/registries/{id}/lines/{lineId}/dispute',
    summary: 'Оспорить отклонённую строку',
    tags: ['Реестры'],
    security: secured('registries:write'),
    request: { headers: idem, params: z.object({ id: z.string().uuid(), lineId: z.string().uuid() }), body: json(S.disputeRequest, { comment: 'Направление было, прикладываем' }) },
    responses: { 200: { description: 'Реестр', ...json(Registry) }, 401: errors[401], 404: errors[404], 409: { description: 'Строку нельзя оспорить', content: { 'application/problem+json': { schema: Problem } } } },
  });
  r.registerPath({
    method: 'get',
    path: '/payments',
    summary: 'Оплаты реестров',
    tags: ['Оплаты'],
    security: secured('payments:read'),
    request: { query: z.object({ period: S.period.optional(), cursor: z.string().optional(), limit: z.number().int().min(1).max(100).optional() }) },
    responses: { 200: { description: 'Оплаты', ...json(PaymentList) }, 401: errors[401] },
  });

  return new OpenApiGeneratorV31(r.definitions).generateDocument({
    openapi: '3.1.0',
    info: {
      title: 'MIG ДМС — API интеграции клиник',
      version: '1.0.0',
      description:
        'API для медицинских информационных систем клиник. JSON по HTTPS, ошибки в формате application/problem+json (RFC 9457), ' +
        'каждый ответ содержит X-Request-Id, POST принимает Idempotency-Key, лимит 60 запросов в минуту на ключ. ' +
        'Данные пациента доступны только через визит клиники. Сущности соответствуют ресурсам HL7 FHIR: Patient, Coverage, Appointment, Claim.',
    },
    servers: [{ url: S.INTEGRATION_BASE }],
    tags: ['Авторизация', 'Пациенты', 'Записи', 'Гарантийные письма', 'Реестры', 'Оплаты'].map((name) => ({ name })),
  } as Parameters<OpenApiGeneratorV31['generateDocument']>[0]);
}
