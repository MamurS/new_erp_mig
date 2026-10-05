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
    flows: { clientCredentials: { tokenUrl: `${S.INTEGRATION_BASE}/oauth/token`, scopes: Object.fromEntries(S.ALL_SCOPES.map((s) => [s, s])) } },
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

  // ---------------- assistance companies (ASSISTANCE_SPEC §8), a separate section ----------------
  const RosterPage = r.register('AssistanceRosterPage', S.rosterPage);
  const InsuredLimits = r.register('AssistanceInsuredLimits', S.insuredLimits);
  const Case = r.register('AssistanceCase', S.assistanceCase);
  const GuaranteeList = r.register('GuaranteeList', S.guaranteeList);
  const RegistryList = r.register('AssistanceRegistryList', S.registryList);
  const Rebill = r.register('Rebill', S.rebill);
  const A = '/assistance';
  const tagA = (t: string) => [`Ассистанс: ${t}`];
  const conflict = { description: 'Действие невозможно в текущем состоянии', content: { 'application/problem+json': { schema: Problem } } };
  r.registerPath({
    method: 'get',
    path: `${A}/roster`,
    summary: 'Застрахованные ассистанса с лимитами и остатками',
    description: 'Только люди, чей полис закреплён за ассистансом сегодня. `updatedSince` — изменения после момента времени; постранично по курсору.',
    tags: tagA('застрахованные'),
    security: secured('roster:read'),
    request: { query: S.rosterQuery },
    responses: { 200: { description: 'Страница списка', ...json(RosterPage) }, 401: errors[401], 403: errors[403], 422: errors[422] },
  });
  r.registerPath({
    method: 'get',
    path: `${A}/insured/{id}/limits`,
    summary: 'Лимиты застрахованного с учётом резервов ГП',
    tags: tagA('застрахованные'),
    security: secured('roster:read'),
    request: { params: z.object({ id: z.string().uuid() }) },
    responses: { 200: { description: 'Лимиты', ...json(InsuredLimits) }, 401: errors[401], 404: errors[404] },
  });
  r.registerPath({
    method: 'post',
    path: `${A}/cases`,
    summary: 'Создать обращение колл-центра',
    tags: tagA('обращения'),
    security: secured('cases:write'),
    request: { headers: idem, body: json(S.caseCreateRequest, { insuredId: EXAMPLES.id, type: 'appointment', description: 'Просит записать к терапевту' }) },
    responses: { 201: { description: 'Обращение', ...json(Case) }, ...errors },
  });
  r.registerPath({
    method: 'patch',
    path: `${A}/cases/{id}`,
    summary: 'Изменить статус обращения',
    tags: tagA('обращения'),
    security: secured('cases:write'),
    request: { params: z.object({ id: z.string().uuid() }), body: json(S.caseUpdateRequest, { status: 'resolved', resolution: 'Записан на 02.10, 10:30' }) },
    responses: { 200: { description: 'Обращение', ...json(Case) }, 401: errors[401], 403: errors[403], 404: errors[404], 422: errors[422] },
  });
  r.registerPath({
    method: 'get',
    path: `${A}/appointments`,
    summary: 'Записи своих застрахованных',
    tags: tagA('записи'),
    security: secured('appointments:write'),
    request: { query: S.assistAppointmentQuery },
    responses: { 200: { description: 'Страница записей', ...json(AppointmentList) }, 401: errors[401], 403: errors[403] },
  });
  for (const [action, summary, body] of [
    ['confirm', 'Подтвердить запись вместо клиники (после её срока ответа)', null],
    ['reschedule', 'Предложить другое время', S.rescheduleRequest],
    ['decline', 'Отклонить запись', S.declineRequest],
  ] as const) {
    r.registerPath({
      method: 'post',
      path: `${A}/appointments/{id}/${action}`,
      summary,
      tags: tagA('записи'),
      security: secured('appointments:write'),
      request: { headers: idem, params: z.object({ id: z.string().uuid() }), ...(body ? { body: { content: { 'application/json': { schema: body } } } } : {}) },
      responses: { 200: { description: 'Запись', ...json(Appointment) }, 401: errors[401], 404: errors[404], 409: conflict },
    });
  }
  r.registerPath({
    method: 'get',
    path: `${A}/guarantees`,
    summary: 'Гарантийные письма своих застрахованных',
    tags: tagA('гарантийные письма'),
    security: secured('guarantees:decide'),
    request: { query: S.guaranteeQuery },
    responses: { 200: { description: 'Страница писем', ...json(GuaranteeList) }, 401: errors[401], 403: errors[403] },
  });
  r.registerPath({
    method: 'post',
    path: `${A}/guarantees/{id}/decide`,
    summary: 'Решение по ГП: одобрить в пределах полномочий, отклонить или эскалировать в МИГ',
    description: 'Сумма одобрения не больше полномочий по договору; выше — `escalate` с заключением врача, решает МИГ. Одобренная сумма резервирует лимит.',
    tags: tagA('гарантийные письма'),
    security: secured('guarantees:decide'),
    request: { headers: idem, params: z.object({ id: z.string().uuid() }), body: json(S.guaranteeDecideRequest, { decision: 'approve', amount: 1_700_000, validUntil: '2026-10-30' }) },
    responses: { 200: { description: 'Письмо', ...json(GuaranteeLetter) }, ...errors, 409: conflict },
  });
  r.registerPath({
    method: 'get',
    path: `${A}/registries`,
    summary: 'Подреестры клиник: только строки этого ассистанса',
    tags: tagA('реестры'),
    security: secured('registries:review'),
    request: { query: S.registryQuery },
    responses: { 200: { description: 'Страница подреестров', ...json(RegistryList) }, 401: errors[401], 403: errors[403] },
  });
  r.registerPath({
    method: 'post',
    path: `${A}/registries/{id}/lines/{lineId}/decide`,
    summary: 'Принять или отклонить строку реестра',
    description: 'Принятая строка списывает лимит, резерв её ГП снимается.',
    tags: tagA('реестры'),
    security: secured('registries:review'),
    request: { headers: idem, params: z.object({ id: z.string().uuid(), lineId: z.string().uuid() }), body: json(S.lineDecideRequest, { decision: 'accept' }) },
    responses: { 200: { description: 'Подреестр', ...json(Registry) }, 401: errors[401], 404: errors[404], 409: conflict, 422: errors[422] },
  });
  r.registerPath({
    method: 'post',
    path: `${A}/registries/{id}/payments`,
    summary: 'Отметить оплату клинике',
    tags: tagA('реестры'),
    security: secured('payments:write'),
    request: { headers: idem, params: z.object({ id: z.string().uuid() }), body: json(S.clinicPaymentRequest, { lineIds: [EXAMPLES.id], paidAt: '2026-09-25', amount: 171_000, paymentOrderNumber: 'PP-10452' }) },
    responses: { 200: { description: 'Подреестр', ...json(Registry) }, 401: errors[401], 404: errors[404], 409: conflict, 422: errors[422] },
  });
  r.registerPath({
    method: 'post',
    path: `${A}/rebills`,
    summary: 'Выставить МИГ счёт на возмещение за месяц',
    description: 'Строки, оплаченные клиникам в периоде (или переданные `lineIds`), плюс вознаграждение по договору. Счёт сразу отправляется в МИГ; автоматические проверки видны в `lines[].checks`.',
    tags: tagA('счета МИГ'),
    security: secured('rebills:write'),
    request: { headers: idem, body: json(S.rebillCreateRequest, { period: '2026-09' }) },
    responses: { 201: { description: 'Счёт', ...json(Rebill) }, ...errors, 409: conflict },
  });
  r.registerPath({
    method: 'get',
    path: `${A}/rebills/{id}`,
    summary: 'Счёт со статусами строк',
    tags: tagA('счета МИГ'),
    security: secured('rebills:write'),
    request: { params: z.object({ id: z.string().uuid() }) },
    responses: { 200: { description: 'Счёт', ...json(Rebill) }, 401: errors[401], 404: errors[404] },
  });
  r.registerPath({
    method: 'post',
    path: `${A}/rebills/{id}/lines/{lineId}/dispute`,
    summary: 'Оспорить отклонённую строку счёта',
    tags: tagA('счета МИГ'),
    security: secured('rebills:write'),
    request: { headers: idem, params: z.object({ id: z.string().uuid(), lineId: z.string().uuid() }), body: json(S.disputeRequest, { comment: 'Лимит пересчитан, прикладываем расчёт' }) },
    responses: { 200: { description: 'Счёт', ...json(Rebill) }, 401: errors[401], 404: errors[404], 409: conflict },
  });

  return new OpenApiGeneratorV31(r.definitions).generateDocument({
    openapi: '3.1.0',
    info: {
      title: 'MIG ДМС — API интеграции клиник и ассистансов',
      version: '1.0.0',
      description:
        'API для медицинских информационных систем клиник. JSON по HTTPS, ошибки в формате application/problem+json (RFC 9457), ' +
        'каждый ответ содержит X-Request-Id, POST принимает Idempotency-Key, лимит 60 запросов в минуту на ключ. ' +
        'Данные пациента доступны клинике только через визит, ассистансу — только по своим застрахованным на дату события. ' +
        'Ключи принадлежат партнёру (клиника или ассистанс): методы раздела «Ассистанс» закрыты для ключей клиник и наоборот. ' +
        'Сущности соответствуют ресурсам HL7 FHIR: Patient, Coverage, Appointment, Claim.',
    },
    servers: [{ url: S.INTEGRATION_BASE }],
    tags: [
      'Авторизация',
      'Пациенты',
      'Записи',
      'Гарантийные письма',
      'Реестры',
      'Оплаты',
      'Ассистанс: застрахованные',
      'Ассистанс: обращения',
      'Ассистанс: записи',
      'Ассистанс: гарантийные письма',
      'Ассистанс: реестры',
      'Ассистанс: счета МИГ',
    ].map((name) => ({ name })),
  } as Parameters<OpenApiGeneratorV31['generateDocument']>[0]);
}
