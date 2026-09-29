# ТЗ: фронтенд-прототип системы ДМС MIG

Версия 1.0 · 29.09.2026

Прототип нужен, чтобы показать коллегам всю систему в работе: пройти любой сценарий, увидеть, кто что видит, и собрать замечания до разработки базы и бэкенда. Всё, что здесь описано, строится сразу в том виде, в каком потом подключится к настоящему API.

---

## 1. Принципы

1. **Прототип выглядит и ведёт себя как готовый продукт.** Каждая кнопка что-то делает, каждый список фильтруется, у каждой формы есть валидация, у каждого экрана есть состояния загрузки, пустоты и ошибки.
2. **Мок равен бэкенду.** Мок-сервер сам определяет пользователя по сессии, сам проверяет права, сам маскирует данные и сам пишет аудит. Фронт ему не доверяет, а он не доверяет фронту.
3. **Данные вымышленные.** Никаких реальных компаний, людей и медданных.
4. **Логика важнее украшений.** Любое действие пользователь находит там, где ожидает, названо оно одинаково на всём пути, а результат виден сразу.

---

## 2. Порталы, роли, демо-доступ

| Портал | Путь | Роли | Визуальный режим |
|---|---|---|---|
| Портал сотрудников МИГ | `/staff` | `operator`, `underwriter`, `doctor_expert`, `accountant`, `admin` | `staff` |
| Кабинет HR клиента | `/hr` | `hr` | `client` |
| Приложение застрахованного | `/app` | `insured` | `client` |

Роли:

- **Оператор ДМС** (`operator`) — записи к врачу, первичная обработка убытков, работа с застрахованными.
- **Андеррайтер** (`underwriter`) — клиенты, полисы, программы, продления, коммерческие предложения, подтверждение изменений лимитов.
- **Врач-эксперт** (`doctor_expert`) — медицинская экспертиза убытков, доступ к медкарте с указанием причины.
- **Бухгалтер** (`accountant`) — счета клиентам, выплаты по одобренным убыткам.
- **Администратор** (`admin`) — пользователи и роли, журнал аудита, статус интеграций. Доступа к медданным и убыткам нет: это разделение обязанностей.
- **HR клиента** (`hr`) — сотрудники своей компании, документы, счета, агрегированная статистика.
- **Застрахованный** (`insured`) — только свои данные.

Демо-аккаунты создаются в seed и показываются на экране входа, только если `VITE_DEMO_MODE=true`:

| Роль | Логин | Пароль | Код MFA/SMS |
|---|---|---|---|
| operator | `operator@demo.mig.uz` | `Demo-2026!` | `000000` |
| underwriter | `underwriter@demo.mig.uz` | `Demo-2026!` | `000000` |
| doctor_expert | `doctor@demo.mig.uz` | `Demo-2026!` | `000000` |
| accountant | `accountant@demo.mig.uz` | `Demo-2026!` | `000000` |
| admin | `admin@demo.mig.uz` | `Demo-2026!` | `000000` |
| hr | `hr@demo-client.uz` | `Demo-2026!` | `000000` |
| insured | телефон `+998 90 000 00 01` | — | `000000` |

Демо-баннер закреплён вверху экрана во всех порталах: «Демо-версия · все данные вымышленные». В нём есть переключатель «Войти как…» со списком ролей (он выполняет настоящий вход через мок-API, а не подмену роли на клиенте), кнопка «Сбросить данные» и тумблер «Имитировать сбои сети».

---

## 3. Карта экранов и маршруты

`/` перенаправляет по роли из сессии: сотрудники на `/staff`, HR на `/hr`, застрахованный на `/app`, без сессии на `/login`.

### Вход

| Маршрут | Экран |
|---|---|
| `/login` | Вход для сотрудников и HR: email и пароль |
| `/login/otp` | Второй фактор: 6-значный код |
| `/app/login` | Вход застрахованного: номер телефона |
| `/app/login/code` | Код из SMS |
| `/app/consent` | Согласие на обработку персональных данных (при первом входе) |

### Портал сотрудников `/staff`

| Маршрут | Экран | Кто видит |
|---|---|---|
| `/staff` | Рабочий стол | все роли сотрудников |
| `/staff/clients` | Клиенты: таблица и боковая панель | operator, underwriter, accountant, admin |
| `/staff/clients/:clientId` | Карточка клиента (вкладки) | те же |
| `/staff/insured/:insuredId` | Карточка застрахованного | operator, underwriter, doctor_expert |
| `/staff/policies` | Полисы | operator, underwriter, accountant |
| `/staff/policies/:policyId` | Карточка полиса | те же |
| `/staff/claims` | Убытки | operator, doctor_expert, accountant |
| `/staff/claims/:claimId` | Карточка убытка | те же |
| `/staff/appointments` | Записи к врачу | operator, doctor_expert |
| `/staff/clinics` | Клиники | operator, underwriter, doctor_expert, admin |
| `/staff/limit-requests` | Запросы на изменение лимитов | operator (свои), underwriter (все) |
| `/staff/reports` | Отчёты | underwriter, accountant |
| `/staff/audit` | Журнал аудита | admin |
| `/staff/admin/users` | Пользователи и роли | admin |

### Кабинет HR `/hr`

| Маршрут | Экран |
|---|---|
| `/hr` | Сотрудники |
| `/hr/employees/new` | Добавить сотрудника |
| `/hr/import` | Загрузка списка из CSV |
| `/hr/documents` | Счета и документы |
| `/hr/stats` | Статистика (только агрегаты) |
| `/hr/help` | Помощь и контакты менеджера |

### Приложение застрахованного `/app`

| Маршрут | Экран |
|---|---|
| `/app` | Главная |
| `/app/card` | Карточка для клиники (QR) |
| `/app/booking` | Запись к врачу, 3 шага |
| `/app/appointments` | Мои записи |
| `/app/claims` | Мои возмещения |
| `/app/claims/new` | Вернуть деньги за чек, 2 шага |
| `/app/claims/:claimId` | Статус возмещения |
| `/app/clinics` | Клиники |
| `/app/chat` | Чат с оператором |
| `/app/profile` | Профиль, язык, выход |

### Служебные

`/403` (нет доступа), любой неизвестный путь показывает 404, плюс глобальный ErrorBoundary.

---

## 4. Матрица доступа

Единственный источник прав — `src/shared/auth/permissions.ts`:

```ts
export type Action = keyof typeof PERMISSIONS;
export function can(user: SessionUser, action: Action, ctx?: PermissionContext): boolean;
```

Обозначения: ✓ — разрешено, ✗ — запрещено, «свои» — только записи, где `companyId`/`insuredId` совпадает с сессией, «маск.» — данные приходят замаскированными.

| Действие | operator | underwriter | doctor_expert | accountant | admin | hr | insured |
|---|---|---|---|---|---|---|---|
| `clients.read` | ✓ | ✓ | ✗ | ✓ | ✓ | ✗ | ✗ |
| `clients.write` | ✗ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |
| `policies.read` | ✓ | ✓ | ✗ | ✓ | ✗ | свои | свой |
| `policies.write` (создать, продлить, КП) | ✗ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |
| `insured.read` | маск. | маск. | маск. | только ФИО | ✗ | свои, маск. | себя, маск. |
| `insured.reveal_pii` (с причиной) | ✓ | ✗ | ✓ | ✗ | ✗ | ✗ | ✗ |
| `medical.read` (с причиной, 15 мин) | ✗ | ✗ | ✓ | ✗ | ✗ | ✗ | ✗ |
| `claims.read` | ✓ | ✗ | ✓ | ✓ | ✗ | ✗ | свои |
| `claims.transition` | new→review→medical_review / approved / rejected | ✗ | medical_review→approved / rejected | approved→to_pay→paid | ✗ | ✗ | ✗ |
| `claims.create` | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | свои |
| `appointments.read` | ✓ | ✗ | ✓ | ✗ | ✗ | ✗ | свои |
| `appointments.manage` (подтвердить, отклонить) | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | создать, отменить свои |
| `clinics.read` | ✓ | ✓ | ✓ | ✗ | ✓ | ✗ | ✓ |
| `limits.request_change` | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |
| `limits.approve_change` | ✗ | ✓, кроме своих | ✗ | ✗ | ✗ | ✗ | ✗ |
| `reports.read` | ✗ | ✓ | ✗ | ✓ | ✗ | агрегаты своих | ✗ |
| `exports.create` | ✗ | ✓ | ✗ | ✓ | ✗ | свои сотрудники | ✗ |
| `audit.read` | ✗ | ✗ | ✗ | ✗ | ✓ | ✗ | ✗ |
| `users.manage` | ✗ | ✗ | ✗ | ✗ | ✓ | ✗ | ✗ |
| `hr.employees.manage` | ✗ | ✗ | ✗ | ✗ | ✗ | свои | ✗ |

Дополнительные правила, которые проверяет мок-сервер:

- **Четыре глаза.** Запрос на изменение лимита не может подтвердить тот, кто его создал (ответ 409 `conflict`). Пользователь, который перевёл убыток в `approved`, не может перевести его в `paid`.
- **Медэкспертиза обязательна**, если категория убытка `dental` или `inpatient` или сумма больше 5 000 000 UZS. Переход `review → approved` в таких случаях запрещён, только `review → medical_review`.
- **Чужое не существует.** Запрос к `/api/me/...` или к ресурсу чужой компании (для hr) по чужому id возвращает 404, а не 403, чтобы нельзя было перебирать id.
- **Роль берётся только из сессии на стороне мока.** Заголовки и параметры, в которых клиент «сообщает» свою роль, игнорируются.

---

## 5. Модель данных

Создай файл `src/shared/types/index.ts` с этим содержимым и дополняй только при необходимости, записывая изменения в DECISIONS.md.

```ts
export type UUID = string;
export type ISODate = string;      // '2026-09-29'
export type ISODateTime = string;  // '2026-09-29T14:21:00+05:00'
export type Money = number;        // целые сумы UZS

export type StaffRole = 'operator' | 'underwriter' | 'doctor_expert' | 'accountant' | 'admin';
export type Role = StaffRole | 'hr' | 'insured';

export interface SessionUser {
  id: UUID;
  role: Role;
  displayName: string;
  companyId?: UUID;        // для hr
  insuredId?: UUID;        // для insured
  consentGivenAt?: ISODateTime; // для insured
}

export type ProgramCode = 'basic' | 'standard' | 'standard_plus' | 'premium';
export type LimitCategory = 'outpatient' | 'dental' | 'medicines' | 'inpatient';

export interface Program {
  code: ProgramCode;
  name: string;                           // 'Базовая' | 'Стандарт' | 'Стандарт+' | 'Премиум'
  limits: Record<LimitCategory, Money>;
}

export type ClientStatus = 'draft' | 'negotiation' | 'active' | 'renewal' | 'expired';

export interface Client {
  id: UUID;
  legalForm: 'ООО' | 'АО' | 'СП ООО' | 'ЧП';
  name: string;
  inn: string;                             // 9 цифр, не ПДн
  status: ClientStatus;
  managerId: UUID;
  managerName: string;
  hrContact: { name: string; phoneMasked: string; emailMasked: string };
  activePolicyId?: UUID;
  program?: ProgramCode;
  insuredCount: number;
  premium: Money;
  lossRatio: number | null;                // 0..1.5, null если полиса ещё нет
  renewalDate?: ISODate;
  createdAt: ISODateTime;
}

export type PolicyStatus = 'draft' | 'active' | 'expired' | 'cancelled';

export interface Policy {
  id: UUID;
  number: string;                          // 'ДМС-2026-000123'
  clientId: UUID;
  clientName: string;
  program: ProgramCode;
  startDate: ISODate;
  endDate: ISODate;
  status: PolicyStatus;
  premium: Money;
  insuredCount: number;
}

export type AppStatus = 'active' | 'invited' | 'not_invited';

export interface Insured {
  id: UUID;
  clientId: UUID;
  clientName: string;
  policyId: UUID;
  fullName: string;
  position: string;
  birthDateMasked: string;                 // '••.••.1987'
  pinflMasked: string;                     // '••••••••••1234'
  phoneMasked: string;                     // '+998 •• ••• •• 67'
  familyMembersCount: number;
  appStatus: AppStatus;
  myIdVerified: boolean;
  attachedClinicId: UUID;
  insuredFrom: ISODate;
  status: 'active' | 'excluded';
}

export type PiiField = 'pinfl' | 'phone' | 'birthDate' | 'email';

export interface LimitUsage {
  category: LimitCategory;
  limit: Money;
  used: Money;
}

export type ClaimStatus = 'new' | 'review' | 'medical_review' | 'approved' | 'rejected' | 'to_pay' | 'paid';
export type ClaimCategory = 'medicines' | 'doctor_visit' | 'diagnostics' | 'dental' | 'inpatient';
export type ClaimSource = 'app' | 'clinic_invoice' | 'operator';

export interface Attachment {
  id: UUID;
  kind: 'receipt' | 'invoice' | 'referral' | 'other';
  fileName: string;                        // без ПДн: 'receipt-1.jpg'
  mime: 'image/jpeg' | 'image/png' | 'image/webp' | 'application/pdf';
  sizeBytes: number;
  url: string;                             // только blob: или /api/files/:id
}

export interface ClaimEvent {
  at: ISODateTime;
  actorName: string;
  from?: ClaimStatus;
  to: ClaimStatus;
  comment?: string;
}

export interface Claim {
  id: UUID;
  number: string;                          // 'У-2026-004512'
  insuredId: UUID;
  insuredName: string;
  clientId: UUID;
  clientName: string;
  category: ClaimCategory;
  source: ClaimSource;
  amountClaimed: Money;
  amountApproved?: Money;
  providerName: string;
  serviceDate: ISODate;
  status: ClaimStatus;
  slaDueAt: ISODateTime;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  attachments: Attachment[];
  history: ClaimEvent[];
  approvedById?: UUID;
}

/** То, что видит застрахованный: без внутренних комментариев и имён сотрудников. */
export interface MyClaim {
  id: UUID;
  number: string;
  category: ClaimCategory;
  amountClaimed: Money;
  amountApproved?: Money;
  providerName: string;
  serviceDate: ISODate;
  status: 'received' | 'checking' | 'approved' | 'rejected' | 'paid';
  steps: { key: 'received' | 'checked' | 'approved' | 'paid'; at?: ISODateTime; done: boolean }[];
  expectedPayoutBy?: ISODate;
  rejectionReason?: string;                // понятным языком
  payoutCardMasked: string;                // '•••• 4417'
}

export type Specialty =
  | 'therapist' | 'pediatrician' | 'dentist' | 'cardiologist'
  | 'gynecologist' | 'ent' | 'neurologist' | 'ophthalmologist';

export type AppointmentStatus = 'requested' | 'confirmed' | 'declined' | 'completed' | 'cancelled';

export interface Appointment {
  id: UUID;
  insuredId: UUID;
  insuredName: string;
  clientName: string;
  clinicId: UUID;
  clinicName: string;
  specialty: Specialty;
  startsAt: ISODateTime;
  status: AppointmentStatus;
  createdAt: ISODateTime;
}

export interface Clinic {
  id: UUID;
  name: string;
  address: string;
  district: string;
  specialties: Specialty[];
  onlineBooking: boolean;
  apiStatus: 'online' | 'offline' | 'manual';
  contractUntil: ISODate;
  distanceKm?: number;                     // заполняется для /api/me/... (вымышленное)
}

export interface Slot {
  clinicId: UUID;
  startsAt: ISODateTime;
}

export interface MedicalRecordEntry {
  id: UUID;
  insuredId: UUID;
  date: ISODate;
  clinicName: string;
  specialty: Specialty;
  diagnosisCode: string;                   // МКБ-10, вымышленные сочетания
  summary: string;
}

export type AuditAction =
  | 'login' | 'logout' | 'login_failed'
  | 'reveal_pii' | 'open_medical'
  | 'limit_change_request' | 'limit_change_approve' | 'limit_change_reject'
  | 'claim_transition' | 'export'
  | 'role_change' | 'user_deactivate'
  | 'hr_add_employee' | 'hr_exclude_employee' | 'hr_import';

export interface AuditEntry {
  id: UUID;
  at: ISODateTime;
  actorId: UUID;
  actorName: string;
  actorRole: Role;
  action: AuditAction;
  targetType: 'insured' | 'claim' | 'policy' | 'client' | 'export' | 'user' | 'session';
  targetId?: UUID;
  targetLabel?: string;                    // без ПДн: номер полиса или убытка, либо «Застрахованный #a1b2»
  reason?: string;
}

export interface LimitChangeRequest {
  id: UUID;
  policyId: UUID;
  policyNumber: string;
  insuredId?: UUID;
  category: LimitCategory;
  from: Money;
  to: Money;
  justification: string;
  requestedById: UUID;
  requestedByName: string;
  status: 'pending' | 'approved' | 'rejected';
  decidedById?: UUID;
  decidedByName?: string;
  createdAt: ISODateTime;
}

export interface Invoice {
  id: UUID;
  clientId: UUID;
  number: string;
  amount: Money;
  issuedAt: ISODate;
  dueDate: ISODate;
  status: 'unpaid' | 'paid' | 'overdue';
}

export interface ClientDocument {
  id: UUID;
  clientId: UUID;
  title: string;
  kind: 'policy' | 'contract' | 'invoice' | 'act' | 'program';
  createdAt: ISODate;
}

export interface ChatMessage {
  id: UUID;
  from: 'insured' | 'operator';
  text: string;
  at: ISODateTime;
}

export interface StaffUser {
  id: UUID;
  fullName: string;
  email: string;
  role: StaffRole;
  active: boolean;
  lastLoginAt?: ISODateTime;
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ApiError {
  code: 'unauthorized' | 'forbidden' | 'not_found' | 'validation' | 'conflict' | 'rate_limited' | 'server';
  message: string;                         // безопасный текст для показа пользователю
  fields?: Record<string, string>;         // ошибки валидации по полям
}
```

DTO для экранов (например, `DashboardSummary`, `HrStats`) описывай рядом, в `src/shared/types/dto.ts`.

---

## 6. Мок-API

### 6.1 Общие правила

- Все обработчики лежат в `src/mocks/handlers/*`, данные — в `src/mocks/db.ts` (в памяти), генерация — в `src/mocks/seed.ts`.
- Сессия: после входа мок выдаёт непрозрачный `sessionId` (32 случайных байта в base64url). Клиент передаёт его в заголовке `Authorization: Bearer <sessionId>`. Мок сам хранит сессию: пользователь, роль, время последней активности.
- Каждый обработчик начинается с `requireSession()` и `requirePermission(action, ctx)`. Без сессии ответ 401, без права — 403, на чужой ресурс — 404.
- Тело запроса проверяется той же zod-схемой, что и форма. Ошибка даёт 422 с `ApiError.fields`.
- Задержка ответа случайная, 150–450 мс. При включённом тумблере «Имитировать сбои» 10% запросов отвечают 500.
- Ответы с ПДн всегда маскированы. Открытые значения появляются только в ответе `reveal`.
- Пагинация: `?page=1&pageSize=25`, сортировка: `?sort=premium:desc`, поиск: `?q=`.
- «Сбросить данные» пересоздаёт БД из seed. Seed детерминированный: генератор mulberry32 с зерном `20260929`.

### 6.2 Эндпоинты

Авторизация:

```
POST /api/auth/login            {email, password} → {challengeId}      (сотрудники и HR)
POST /api/auth/otp              {challengeId, code} → {sessionId, user}
POST /api/auth/phone            {phone} → {challengeId}                (застрахованный)
POST /api/auth/phone/verify     {challengeId, code} → {sessionId, user}
POST /api/auth/logout
GET  /api/auth/me               → SessionUser
```

После 5 неудачных попыток за 10 минут вход блокируется на 5 минут (429 `rate_limited`). Тексты ошибок общие: «Неверный email или пароль», без уточнения, что именно неверно.

Портал сотрудников:

```
GET   /api/dashboard                              → DashboardSummary (содержимое зависит от роли)
GET   /api/queue?type=all|appointment|claim|renewal
GET   /api/clients?q&status&program&managerId&sort&page
GET   /api/clients/:id
POST  /api/clients                                 (underwriter)
PATCH /api/clients/:id                             (underwriter)
GET   /api/clients/:id/insured?q&page
GET   /api/clients/:id/documents
GET   /api/policies?q&status&program&sort&page
GET   /api/policies/:id
POST  /api/policies/:id/renewal-offer              (underwriter) → создаёт документ КП
GET   /api/insured?q&clientId&page
GET   /api/insured/:id
GET   /api/insured/:id/limits                      → LimitUsage[]
POST  /api/insured/:id/reveal                      {field: PiiField, reason} → {value, expiresInSec: 30}
POST  /api/insured/:id/medical-access              {reason} → {grantId, expiresAt}   (doctor_expert)
GET   /api/insured/:id/medical                     Header X-Medical-Grant → MedicalRecordEntry[]
GET   /api/claims?status&category&q&overdue&sort&page
GET   /api/claims/:id
POST  /api/claims/:id/transition                   {to, amountApproved?, comment}
GET   /api/appointments?status&date&page
POST  /api/appointments/:id/confirm
POST  /api/appointments/:id/decline                {reason}
GET   /api/clinics?q&specialty
GET   /api/limit-requests?status
POST  /api/limit-requests                          {policyId, insuredId?, category, to, justification}
POST  /api/limit-requests/:id/approve
POST  /api/limit-requests/:id/reject               {comment}
GET   /api/reports/loss-ratio-by-client
GET   /api/reports/claims-by-category?from&to
GET   /api/reports/premium-by-month
POST  /api/exports                                 {type: 'clients'|'claims_financial'|'policies'} → CSV (text/csv)
GET   /api/audit?action&actorId&from&to&page       (admin)
GET   /api/admin/users
PATCH /api/admin/users/:id                         {role?, active?}
GET   /api/integrations/status                     → [{name, status, lastSyncAt, queue}]
GET   /api/files/:id                               → изображение (из seed) с проверкой прав
```

Кабинет HR (компания определяется сессией, `companyId` в запросе не передаётся):

```
GET    /api/hr/overview                 → {insuredCount, notInApp, nextInvoice, policy}
GET    /api/hr/employees?q&filter=all|not_in_app|recent&page
POST   /api/hr/employees                {fullName, birthDate, pinfl, phone, position, startDate}
DELETE /api/hr/employees/:id            {excludeFrom} (мягкое исключение с даты)
POST   /api/hr/employees/import         CSV → {valid: n, errors: [{row, field, message}]}
POST   /api/hr/employees/invite         {ids | 'all_not_in_app'}
GET    /api/hr/documents
GET    /api/hr/invoices
GET    /api/hr/stats                    → только агрегаты, правило k ≥ 10
POST   /api/exports                     {type: 'hr_employees'} → CSV без ПИНФЛ и дат рождения
```

Приложение застрахованного (личность определяется сессией, id застрахованного в запросе не передаётся):

```
GET  /api/me                          → профиль (маскированный)
POST /api/me/consent                  {version} → {consentGivenAt}
GET  /api/me/policy
GET  /api/me/limits                   → LimitUsage[]
GET  /api/me/card-token               → {token, expiresAt}  (живёт 60 секунд)
GET  /api/me/claims
GET  /api/me/claims/:id               → MyClaim (чужой id → 404)
POST /api/me/claims                   multipart: files[], category, amount, serviceDate, providerName
POST /api/me/claims/recognize         multipart: file → {providerName, amount, serviceDate} (имитация распознавания, 1 с)
GET  /api/me/appointments
POST /api/me/appointments             {clinicId, specialty, startsAt}
POST /api/me/appointments/:id/cancel
GET  /api/clinics/nearby?specialty    → Clinic[] с distanceKm
GET  /api/clinics/:id/slots?date      → Slot[]
GET  /api/me/chat
POST /api/me/chat                     {text} → через 2 с появляется ответ оператора
```

### 6.3 Seed

Объёмы:

- 40 компаний-клиентов, у каждой статус из `ClientStatus`: 6 draft/negotiation, 26 active, 5 renewal, 3 expired.
- ~1 500 застрахованных.
- 30 клиник в 12 районах Ташкента.
- 600 убытков за 12 месяцев, распределённых по статусам. Около 15 просрочены по SLA.
- 300 записей к врачу в диапазоне ±14 дней от сегодняшней даты.
- 12 сотрудников МИГ, 500 записей аудита, 8 запросов на изменение лимитов.

Правила генерации:

- Названия компаний составные и вымышленные, например «Ташкент Агрологистика», «Самарканд Текстиль Групп». Известные реальные компании и бренды не использовать.
- ФИО собираются из списков узбекских и русских имён и фамилий, пол согласован с отчеством и окончанием фамилии.
- ПИНФЛ — 14 цифр, ИНН — 9 цифр, телефон в формате `+998 XX XXX XX XX`. Все значения случайные.
- Даты отсчитываются от текущей даты, чтобы прототип выглядел свежим в любой день показа.
- Порядки величин (демо): премия на человека 2–8 млн UZS в год. Лимиты «Стандарт+»: амбулаторно 15 млн, стоматология 3 млн, лекарства 5 млн, стационар 40 млн. Для других программ лимиты пропорционально меньше или больше.
- Изображения чеков генерируются простыми SVG или canvas-картинками внутри seed. Сторонние фото не используются.
- Демо-застрахованный `+998 90 000 00 01` должен давать интересную картину: одно одобренное возмещение, одно на проверке, одна подтверждённая запись, стоматологический лимит израсходован больше чем на 80%.
- Демо-HR принадлежит компании примерно на 45 сотрудников, из которых 8 не установили приложение.

Тестовые данные для проверки на XSS создаются только при `VITE_SEED_XSS=true` (так делают e2e-тесты):

- компания с названием `<img src=x onerror=alert(1)>`;
- застрахованный с должностью `"><script>alert(1)</script>`;
- сообщение в чате `javascript:alert(1)` и `https://example.com`.

---

## 7. Дизайн-система

Визуальный референс утверждён. Повтори токены точно.

### 7.1 Режим `staff` — портал сотрудников

Плотный, спокойный, рабочий. Много информации на экране без визуального шума.

| Токен | Значение |
|---|---|
| `--bg` | `#f8f9fb` |
| `--surface` | `#ffffff` |
| `--rail` | `#f1f3f6` |
| `--border` | `#e6e8ec` |
| `--border-soft` | `#eceef1` |
| `--text` | `#16181d` |
| `--text-muted` | `#57606a` |
| `--accent` | `#4f46e5` |
| `--accent-soft` | `#eef0ff` |
| `--accent-text` | `#4338ca` |
| `--success` / `--success-soft` / `--success-text` | `#16a34a` / `#ecfdf3` / `#166534` |
| `--warning` / `--warning-soft` / `--warning-text` | `#d97706` / `#fef3c7` / `#92400e` |
| `--danger` / `--danger-soft` / `--danger-text` | `#b91c1c` / `#fef2f2` / `#991b1b` |
| `--info` | `#2563eb` |

- Шрифты: Golos Text для всего интерфейса, JetBrains Mono только для сумм, номеров полисов и убытков, ИНН.
- Базовый размер 13 px, заголовок страницы 22 px/700, заголовок блока 14 px/700.
- Радиусы: 6 px у кнопок и чипов, 10 px у блоков.
- Строка таблицы 44 px, строка очереди 46 px.
- Подписи колонок набираются обычным регистром, 12 px, цветом `--text-muted`.
- Каркас: слева иконочная навигация 60 px с подсказками, сверху панель 52 px (заголовок или хлебные крошки, поиск ⌘K, статус «MFA · VPN», главное действие), ниже контент. Боковая панель деталей шириной 380 px справа.
- Статусы показываются точкой и текстом. Типы (Запись, Убыток, Продление) — мягкими чипами: запись `#eef0ff`/`#3730a3`, убыток `#fef3c7`/`#92400e`, продление `#ccfbf1`/`#115e59`.

### 7.2 Режим `client` — кабинет HR и приложение

Тёплый, мягкий, понятный. Крупные элементы, простой язык.

| Токен | Значение |
|---|---|
| `--bg` | `#fbfaf7` |
| `--surface` | `#ffffff` |
| `--border` | `#e8e6df` |
| `--border-soft` | `#f0eee8` |
| `--text` | `#1c2321` |
| `--text-muted` | `#5b6560` |
| `--accent` | `#1f7a5a` |
| `--accent-soft` | `#e3f0ea` |
| `--peach` / `--peach-text` | `#ffe3cf` / `#8a3d12` |
| `--sky` / `--sky-text` | `#e3eefc` / `#1e4b8f` |
| `--sun` / `--sun-text` | `#fff3c4` / `#7a5a00` |

- Шрифты: Rubik 600 для заголовков и крупных сумм, Nunito 400–800 для текста.
- Базовый размер 15 px, заголовок экрана приложения 20–26 px, заголовок HR-кабинета 30 px.
- Радиусы: 12–14 px у полей и кнопок, 18–22 px у карточек, 26 px у главной карточки полиса.
- Высота кнопок 46–54 px, минимальная зона нажатия 44×44.
- Приложение: мобильная вёрстка 360–430 px. На экранах шире 768 px оно показывается колонкой шириной 430 px по центру на фоне `--bg`. Внизу таб-бар: Главная, Возмещения, Клиники, Профиль.
- HR-кабинет: горизонтальная навигация-пилюли сверху, контент на всю ширину до 1440 px.
- Иконки lucide в цветных кружках (sky, peach, sun, accent-soft) на плитках действий.
- Плашка-предупреждение (peach) появляется, когда лимит израсходован на 80% и больше.

### 7.3 Общее

- Контраст текста не ниже WCAG AA. Видимый фокус (`:focus-visible`, обводка 2 px цветом `--accent`).
- `prefers-reduced-motion` отключает все анимации. Из анимаций разрешены только открытие панели и модалки и смена шага мастера.
- Денежные суммы форматируются как `12 500 000 UZS` (`Intl.NumberFormat('ru-RU')`), даты как `29.09.2026`, относительные сроки — «через 16 дн», «сегодня», «−1 дн». Часовой пояс `Asia/Tashkent`.
- Тексты кнопок называют действие: «Подтвердить запись», а не «ОК». Одно действие называется одинаково на всём пути.
- Ошибки объясняют, что случилось и что делать. Пустые списки предлагают действие.

---

## 8. Экраны

Общее для всех списков: поиск, фильтры, сортировка по клику на заголовок колонки, пагинация по 25, состояния загрузки (скелетоны), пустоты и ошибки (с кнопкой «Повторить»). Состояние фильтров хранится в query-параметрах URL, но в них могут быть только статусы, id и числа. ФИО, ПИНФЛ и телефоны в URL не попадают, поэтому строка поиска `q` в URL не сохраняется.

### 8.1 Вход

- **`/login`.** Поля email и пароль, кнопка «Войти». В демо-режиме под формой список демо-аккаунтов с кнопкой «Подставить». После ввода пароля переход на `/login/otp`.
- **`/login/otp`.** 6 отдельных полей (`autocomplete="one-time-code"`), автопереход между ними, вставка из буфера, повторная отправка через 60 секунд.
- **`/app/login`.** Номер телефона с маской `+998 __ ___ __ __` и крупной кнопкой «Получить код». Переключатель RU/UZ.
- **`/app/login/code`** работает так же, как OTP.
- **`/app/consent`.** Текст согласия (заглушка), чекбокс «Я согласен(на) на обработку персональных данных» и кнопка «Продолжить», которая неактивна без чекбокса.
- После входа открывается страница из параметра `?next=`. Разрешены только внутренние пути, начинающиеся с `/` и не с `//`. Иначе открывается домашняя страница роли.

### 8.2 Портал сотрудников

**Рабочий стол `/staff`.**
- Приветствие «Доброе утро, {имя}» с датой и числом задач в очереди.
- Четыре KPI, набор зависит от роли:
  - оператор: активные полисы, записи сегодня, убытки в работе (с числом просроченных по SLA), премия к продлению в Q4;
  - бухгалтер: к оплате, оплачено за месяц, просроченные счета клиентов, дебиторка;
  - врач-эксперт: на экспертизе, записи сегодня, запросы доступа.
- Очередь с вкладками «Все / Записи / Убытки / Продления». Колонки: Тип, Кто (ФИО или клиент), Детали, Статус, Срок, действие в строке («Подтвердить», «Открыть», «Подготовить КП»). Действие из строки выполняется прямо здесь: подтверждение записи обновляет строку без перехода.
- Справа три блока: «Требует внимания» (продления меньше чем через 30 дней без КП, убыточность выше 80%, убытки с просроченным SLA; клик ведёт в отфильтрованный список), «Интеграции» (1С, API клиник, MyID, Didox со статусом и временем последней синхронизации) и «Доступ к медданным» (последние 5 записей аудита типа `reveal_pii`/`open_medical`, только для admin и doctor_expert, остальным блок не показывается).

**Клиенты `/staff/clients`.**
- Сверху сохранённые виды: «Все», «Мои», «Продления Q4», «Убыточность > 80%».
- Фильтры в виде меток: статус, программа, менеджер. Кнопки «Сортировка», «Колонки» (показать или скрыть), «Экспорт в CSV» (если есть `exports.create`).
- Колонки: логотип-инициалы и название, программа, застрахованных, премия, продление (относительный срок, оранжевый при ≤ 30 дн), убыточность (полоска и процент, оранжевая при ≥ 80%), менеджер (аватар-инициалы), статус.
- Клик по строке открывает боковую панель: KPI, блок «Продление» с кнопками «Подготовить КП» и «Письмо HR», контакт HR (маскированный), лента активности, кнопка «Открыть карточку».
- Клавиатура: ↑/↓ перемещают по строкам, Enter открывает панель, Esc закрывает её.
- В футере «N клиентов · премия всего X UZS».

**Карточка клиента `/staff/clients/:clientId`.**
- Шапка с названием, ИНН, статусом и действиями.
- Вкладки:
  - Обзор: KPI и график убытков по месяцам;
  - Застрахованные: таблица, клик ведёт в карточку застрахованного;
  - Полисы;
  - Убытки: агрегаты по категориям без диагнозов;
  - Документы;
  - История: события из аудита по клиенту.

**Карточка застрахованного `/staff/insured/:insuredId`.**
- Шапка: ФИО, компания, полис, программа, срок, чипы «Активен», «MyID ✓», «В приложении».
- Действия: «Записать к врачу», «Гарантийное письмо», «+ Убыток», «Запросить изменение лимита».
- Вкладки: Обзор, Обращения, Документы, Журнал доступа (кто и когда открывал данные этого человека).
- Обзор содержит:
  - лимиты по категориям (полоски, `[использовано] / [лимит]`, оранжевые при ≥ 80%, плашка с предупреждением);
  - последние обращения;
  - блок «Данные» с маскированными значениями. Рядом с ПИНФЛ, телефоном и датой рождения кнопка «Показать». Она открывает модалку с обязательной причиной (минимум 10 символов, есть быстрые варианты: «Обработка убытка №…», «Звонок застрахованного», «Запрос клиники»). После этого значение видно 30 секунд с таймером и кнопкой «Копировать» (копирование тоже пишется в аудит), затем снова маскируется. Подпись под блоком: «Каждый просмотр данных попадает в журнал аудита».
- Блок «Медицинская карта»:
  - для ролей без `medical.read` он закрыт, показан замок и текст «Закрыто для вашей роли. Открыть может врач-эксперт с указанием причины»;
  - врачу-эксперту нужно указать причину, после чего медкарта доступна 15 минут (таймер в шапке блока), затем закрывается автоматически.

**Полисы `/staff/policies` и `/staff/policies/:policyId`.**
- Список полисов с фильтрами.
- Карточка полиса: программа и её лимиты, даты, премия, список застрахованных, документы.
- Кнопка «Подготовить КП на продление» (underwriter) открывает форму: новая программа, премия, срок. Результат — документ КП в списке документов клиента.

**Убытки `/staff/claims` и `/staff/claims/:claimId`.**
- Список с фильтрами: статус, категория, «Просрочен SLA». Колонки: номер, застрахованный, клиент, категория, сумма, статус, SLA.
- Карточка убытка:
  - слева данные и вложения (просмотр изображений в модалке с масштабом);
  - в центре проверка лимита: «Лимит «Стоматология»: использовано X из Y, после выплаты останется Z». Если сумма превышает остаток, показывается предупреждение и предлагается одобрить частично;
  - справа история переходов и комментарии.
- Кнопки переходов показываются только разрешённые для роли и текущего статуса. Для отказа комментарий обязателен. Для частичного одобрения нужно указать сумму.
- Правило медэкспертизы из §4 объясняется подсказкой у недоступной кнопки.

**Записи `/staff/appointments`.**
- Вид «Список» и вид «День» (временная шкала по клиникам).
- Подтверждение и отклонение (с причиной) прямо в строке.

**Клиники `/staff/clinics`.** Таблица: название, район, специальности (чипы), онлайн-запись, статус API, договор до.

**Запросы на изменение лимитов `/staff/limit-requests`.**
- Список со статусами.
- Андеррайтер видит кнопки «Подтвердить» и «Отклонить». У своих собственных запросов кнопки неактивны, с подсказкой «Нужно подтверждение другого сотрудника».

**Отчёты `/staff/reports`.**
- Три графика recharts: убыточность по клиентам (горизонтальные столбцы, порог 80% отмечен линией), убытки по категориям за период, премия по месяцам.
- Выгрузка CSV по каждому.

**Журнал аудита `/staff/audit`.** Фильтры по действию, сотруднику и датам. Колонки: время, сотрудник, роль, действие, объект (без ПДн), причина.

**Пользователи `/staff/admin/users`.**
- Таблица сотрудников, смена роли (с подтверждением), деактивация.
- Администратор не может снять роль admin сам с себя.

**Командная палитра ⌘K / Ctrl+K** доступна везде в портале. Поиск по клиентам (название, ИНН), полисам (номер), застрахованным (ФИО, только для ролей с `insured.read`), убыткам (номер) и навигация по разделам. Клавиша `/` фокусирует поиск на странице.

### 8.3 Кабинет HR

**Сотрудники `/hr`.**
- Заголовок «Сотрудники», подзаголовок «N застрахованы · M ещё не установили приложение».
- Действия: «Загрузить из CSV» и «+ Добавить сотрудника».
- Три карточки: «Следующий счёт» (сумма, срок, «Скачать»), «Полис компании» (программа, срок, «Документы»), персиковая карточка «M сотрудников ещё не в приложении» с кнопкой «Напомнить всем».
- Синяя плашка: «Вы видите, кто застрахован, но не видите диагнозы, визиты и возмещения сотрудников. Это медицинская тайна, и доступа к ней у работодателя нет».
- Таблица сотрудников. Фильтры-пилюли: «Все», «Не в приложении», «Добавлены недавно». Поиск. Колонки: сотрудник (аватар, ФИО, должность), программа, застрахован с, семья, приложение (чип «Пользуется», «Приглашён» или «Не приглашён»), меню (пригласить, исключить с даты).

**Добавить сотрудника `/hr/employees/new`.**
- Поля: ФИО, дата рождения, ПИНФЛ (14 цифр, маска), телефон (маска), должность, дата начала страхования.
- Валидация zod. После сохранения появляется тост «Сотрудник добавлен, приглашение отправлено», а в списке данные уже маскированы.

**Загрузка `/hr/import`.**
- Кнопка «Скачать шаблон CSV».
- Загрузка файла: только `.csv`, до 2 МБ, до 1 000 строк.
- Предпросмотр: зелёные строки корректны, красные с ошибкой по полю. Кнопка «Добавить N сотрудников», строки с ошибками пропускаются. После загрузки показывается итог.

**Счета и документы `/hr/documents`.** Счета (номер, сумма, срок, статус, «Скачать»), документы полиса. Скачивается PDF-заглушка, сгенерированная на клиенте из шаблона, без ПДн сотрудников.

**Статистика `/hr/stats`.**
- Сколько застраховано, сколько пользуется приложением, число обращений за квартал (одно общее число), использование бюджета программы в процентах.
- Любые разрезы, в которых меньше 10 человек, скрыты с подписью «Слишком мало данных для показа». Это k-анонимность.
- Никакой медицины по отдельным людям.

**Помощь `/hr/help`.** Контакт менеджера МИГ, частые вопросы.

### 8.4 Приложение застрахованного

**Главная `/app`.**
- «Салом, {имя}!» / «Добрый день, {имя}!» (зависит от языка), подзаголовок «Чем можем помочь сегодня?». Переключатель RU/UZ и колокольчик уведомлений.
- Карточка полиса (фон `--accent-soft`, декоративные круги): «Вы застрахованы через {компания}», программа, срок, кнопка «Карточка для клиники».
- Четыре плитки: «Записаться к врачу», «Вернуть деньги за чек», «Клиники рядом», «Написать нам».
- Блок «Возмещения»: последнее возмещение с полоской из 4 шагов и статусом понятным языком.
- Блок «Сколько осталось»: лимиты с формулировкой «ещё X UZS». При ≥ 80% полоска персиковая, с подписью «Почти закончилось, дальше за свой счёт». Если лимит не использовался — «не использовали». Ссылка «Что покрывает полис?» открывает модалку с описанием программы.

**Карточка для клиники `/app/card`.**
- Крупный QR, ФИО, номер полиса, программа.
- QR кодирует только `MIG-DMS:{token}`: одноразовый токен, который обновляется каждые 60 секунд (таймер под QR). ПИНФЛ и другие ПДн в QR не попадают.
- Подсказка «Покажите экран администратору клиники».

**Запись `/app/booking`.** Мастер из трёх шагов с индикатором:
1. Выбор врача: сетка специальностей с иконками.
2. Когда и где: день (4 ближайших дня, чипы) и клиники рядом с доступными слотами. Сверху персиковая плашка, если лимит по связанной категории ≥ 80%: «На стоматологию осталось X UZS. Если приём дороже, разницу оплатите в клинике». Внизу строка итога «Клиника · время, день» и кнопка «Продолжить».
3. Подтверждение: сводка, кнопка «Записаться», затем экран успеха «Запись отправлена в клинику, подтверждение придёт уведомлением».

**Мои записи `/app/appointments`.** Предстоящие и прошедшие записи, отмена предстоящей с подтверждением.

**Вернуть деньги за чек `/app/claims/new`.**
- Шаг 1:
  - фото (`<input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" multiple>`, до 5 файлов, каждый до 10 МБ);
  - перекодирование через canvas в JPEG 0.85 с длинной стороной не больше 2 000 px, что удаляет EXIF и геолокацию;
  - превью, после чего «Чек распознан» и автозаполнение полей «Где», «Сумма», «Дата» (их можно править);
  - чипы «Что это было?»: Лекарства, Приём врача, Анализы, Стоматология;
  - плашка «Вернём на карту •••• 4417, обычно за 2 рабочих дня».
- Шаг 2: проверка и кнопка «Отправить». Затем переход на статус.

**Мои возмещения `/app/claims`.** Список карточек: где, сумма, статус понятным языком, полоска шагов.

**Статус `/app/claims/:claimId`.**
- Герой-блок по статусу: «Получили», «Проверяем», «Одобрено!», «Отказано» (с причиной понятным языком и кнопкой «Написать нам»), «Деньги на карте».
- Сумма, вертикальная шкала из 4 шагов с датами, детали: что, где, «на лекарства осталось X».
- Кнопка «Есть вопрос? Напишите нам».

**Клиники `/app/clinics`.** Фильтр по специальности, список с расстоянием, адресом, чипом «по полису» и кнопкой «Записаться сюда», которая открывает мастер со второго шага.

**Чат `/app/chat`.**
- Только текст, до 1 000 символов.
- Ссылки становятся кликабельными, только если проходят `safeUrl()` (http/https). Открываются в новой вкладке с `rel="noopener noreferrer"`.
- Ответ оператора приходит через 2 секунды (мок).

**Профиль `/app/profile`.**
- ФИО, маскированные телефон, ПИНФЛ и карта для выплат.
- Язык, дата согласия на обработку данных, кнопка «Выйти».
- Кнопка «Выйти на всех устройствах» в прототипе просто завершает сессию.

---

## 9. Безопасность фронтенда

Итоговая защита данных обеспечивается бэкендом и RLS в базе. Задача фронта — не создать новых дыр (XSS, утечки через браузер, секреты в сборке), не показывать лишнего и уже сейчас проверять модель доступа через мок-сервер, который ведёт себя как бэкенд.

### 9.1 Код

- ESLint (ошибка, а не предупреждение):
  - `react/no-danger`, `react/jsx-no-script-url`, `react/jsx-no-target-blank`;
  - `no-eval`, `no-implied-eval`, `no-new-func`;
  - `no-restricted-syntax` для присваивания `innerHTML`, `outerHTML`, вызова `insertAdjacentHTML`, `document.write`;
  - `no-restricted-properties` для `window.localStorage` и `localStorage` везде, кроме `src/shared/lib/storage.ts`;
  - `no-restricted-properties` для `sessionStorage` везде, кроме `src/shared/auth/session.ts`;
  - `no-console` везде, кроме `src/shared/lib/logger.ts`;
  - `@typescript-eslint/no-explicit-any`.
- `src/shared/lib/safeUrl.ts`: разрешены только `http:`, `https:`, `mailto:`, `tel:` и относительные пути. Всё остальное превращается в `about:blank`. Покрывается юнит-тестами, включая `JaVaScRiPt:`, пробелы и управляющие символы перед схемой, `data:`, `vbscript:`.
- `src/shared/lib/redirect.ts`: безопасный `next` для редиректа после входа (только `/…`, не `//…`, не `/\…`).
- `src/shared/lib/logger.ts`: уровни `info/warn/error`. Перед выводом вычищает поля с ключами `pinfl|phone|email|birth|passport|card|diagnos|token|session|password` и строки, похожие на ПИНФЛ (14 цифр подряд) и телефоны. В production-сборке `info` не выводится.
- `src/shared/lib/csv.ts`: генерация CSV с экранированием кавычек и защитой от CSV-инъекций (ячейки, начинающиеся с `=`, `+`, `-`, `@`, `\t`, `\r`, получают префикс `'`). Имена файлов вида `clients-2026-09-29.csv`, без ПДн.
- Все ответы API валидируются zod-схемами на границе `client.ts` (в dev при несовпадении выводится предупреждение через logger, пользователю показывается ошибка).

### 9.2 Сессия и доступ

- `src/shared/auth/session.ts`: `sessionId` хранится в памяти и дублируется в `sessionStorage`, чтобы перезагрузка вкладки не выкидывала пользователя. Никакого `localStorage` и cookies в прототипе.
- Тайм-аут неактивности: сотрудники 15 минут (предупреждение с обратным отсчётом на 13-й минуте), HR и застрахованный 30 минут. Активность — клики, нажатия клавиш и запросы.
- Выход: вызов `/api/auth/logout`, очистка кэша TanStack Query (`queryClient.clear()`), `sessionStorage` и состояния, затем переход на страницу входа. Выход синхронизируется между вкладками через `BroadcastChannel('mig-auth')`.
- При ответе 401 выполняется тот же выход с сообщением «Сессия завершена, войдите снова».
- Guards: `RequireAuth`, `RequireRole(roles[])`, `RequirePermission(action)` на уровне маршрутов. Прямой переход по URL без права ведёт на `/403`.
- Кэш запросов не сохраняется на диск (без persist). У запросов с ПДн `gcTime` не больше 5 минут. Ответ `reveal` в кэш не попадает: это `useMutation`, результат живёт в состоянии компонента 30 секунд.
- Медкарта: `grantId` хранится только в памяти компонента и истекает через 15 минут.

### 9.3 Заголовки и CSP

Файл `public/_headers` для Cloudflare Pages:

```
/*
  Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; worker-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'; manifest-src 'self'; upgrade-insecure-requests
  Strict-Transport-Security: max-age=31536000; includeSubDomains
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
  Referrer-Policy: no-referrer
  Permissions-Policy: camera=(self), geolocation=(self), microphone=(), payment=(), usb=(), interest-cohort=()
  Cross-Origin-Opener-Policy: same-origin
  Cross-Origin-Resource-Policy: same-origin
  X-Robots-Tag: noindex, nofollow

/assets/*
  Cache-Control: public, max-age=31536000, immutable

/index.html
  Cache-Control: no-store
```

- `'unsafe-inline'` оставлен только для стилей, потому что Radix выставляет inline-стили позиционирования. Скрипты строго `'self'`.
- `index.html` без inline-скриптов, стилей и обработчиков.
- `public/_redirects`: `/*  /index.html  200`.
- `public/robots.txt`: `User-agent: *` / `Disallow: /`.
- Vite: `build.sourcemap = false`, `build.modulePreload.polyfill = false` (он добавляет inline-скрипт).
- Проверить в Playwright, что в консоли браузера нет нарушений CSP. В `vite preview` заголовки из `_headers` применяются через небольшой плагин или `preview.headers`.

### 9.4 Данные и файлы

- Маскирование делает мок-сервер. Фронт не получает полных ПДн, кроме ответа `reveal`.
- ПДн не пишутся в URL, `document.title` («Карточка застрахованного · MIG», без ФИО), тексты ошибок, имена файлов и логи.
- Загрузка файлов:
  - проверка MIME и расширения по белому списку и магических байтов (первые байты JPEG, PNG, WEBP);
  - лимиты размера и количества;
  - перекодирование изображений через canvas (удаляет EXIF и GPS);
  - превью через `URL.createObjectURL` с `revokeObjectURL` при размонтировании.
- Выгрузки никогда не содержат ПИНФЛ, телефоны, даты рождения и диагнозы. Каждая выгрузка пишется в аудит.
- В HR-статистике действует порог k ≥ 10.
- QR-карточка содержит только одноразовый токен.

### 9.5 Демо-режим

- Весь демо-код лежит в `src/demo/` и подключается динамическим импортом под условием `import.meta.env.VITE_DEMO_MODE === 'true'`. Без флага Vite вырезает его из сборки.
- Юнит-тест собирает проект с `VITE_DEMO_MODE=false` и проверяет, что в `dist/` нет строк `demo.mig.uz`, `Войти как` и `000000`.
- Переключатель «Войти как…» выполняет настоящий вход через мок, а не меняет роль на клиенте.

### 9.6 Зависимости и репозиторий

- `package-lock.json` в репозитории, версии без `^` у критичных пакетов (react, react-dom, react-router-dom, msw, vite).
- `npm audit --audit-level=high` в CI.
- `.github/dependabot.yml` для npm и GitHub Actions, еженедельно.
- Gitleaks в CI (поиск секретов в истории).
- `.gitignore`: `node_modules`, `dist`, `.env*` (кроме `.env.example`), `playwright-report`, `test-results`, `coverage`.
- `.env.example`:
  ```
  VITE_USE_MOCKS=true
  VITE_DEMO_MODE=true
  VITE_API_BASE_URL=/api
  ```

---

## 10. UX-стандарты

- **Навигация.** Активный раздел подсвечен, хлебные крошки на вложенных экранах, «Назад» возвращает с сохранением фильтров.
- **Обратная связь.** Каждое действие даёт тост с тем же глаголом, что на кнопке («Запись подтверждена»). Опасные действия (исключить сотрудника, отклонить убыток, сменить роль) требуют подтверждения в модалке с объяснением последствий.
- **Состояния.** Скелетоны при загрузке, пустые состояния с действием, ошибки с «Повторить». Баннер «Нет соединения» при `navigator.onLine === false`.
- **Формы.** Подписи над полями, ошибки под полем после ухода с поля и при отправке, фокус на первое поле с ошибкой. Кнопка отправки показывает спиннер и блокируется, чтобы не было двойной отправки. Маски для телефона, ПИНФЛ, дат и сумм.
- **Доступность.** Семантические элементы (`button`, `a`, `table`), `aria-label` у иконочных кнопок, `aria-live` для тостов, навигация с клавиатуры, ловушка фокуса в модалках, `lang="ru"` или `lang="uz"` на корне.
- **Производительность.** Ленивые маршруты (`React.lazy`) по порталам, основной бандл портала до 300 КБ gzip.
- **i18n.** `src/i18n/ru.ts` и `src/i18n/uz.ts` с типизированными ключами. Приложение застрахованного переведено полностью, у портала и HR есть только `ru`.

---

## 11. Тесты

**Юнит (Vitest):**
- `permissions.ts`: вся матрица §4, по тесту на ячейку, сгенерированные из таблицы;
- `safeUrl`, `redirect`, `csv`, `logger` (редактирование ПДн), форматтеры денег, дат и относительных сроков;
- маскирование в моке;
- правило «четыре глаза» и правило медэкспертизы;
- проверка отсутствия демо-кода в сборке без флага.

**Компонентные (Testing Library):** форма добавления сотрудника (валидация), модалка reveal (причина обязательна, таймер 30 секунд, повторное маскирование), мастер записи.

**E2E (Playwright, Chromium, `VITE_SEED_XSS=true`):**
1. Вход каждой ролью, MFA, выход, синхронизация выхода между двумя вкладками.
2. Матрица маршрутов: для каждой роли прямой переход на запрещённые маршруты ведёт на `/403`.
3. Матрица API: запросы к запрещённым эндпоинтам через `page.request` с сессией роли возвращают 403 или 404.
4. IDOR: застрахованный запрашивает `/api/me/claims/{чужой id}` и получает 404, HR запрашивает сотрудника другой компании и получает 404.
5. Маскирование: на карточке застрахованного полного ПИНФЛ нет в DOM до reveal, после reveal он есть, через 30 секунд снова нет. Запись появилась в аудите.
6. HR: на страницах `/hr/*` нет элементов с диагнозами, убытками и записями сотрудников.
7. XSS: XSS-строки из seed отображаются как текст, `alert` не вызывается (`page.on('dialog')` падает тест), ссылка `javascript:` не кликабельна.
8. CSP: на всех основных страницах в консоли нет ошибок CSP.
9. Сценарий оператора: подтвердить запись в очереди, провести убыток до `approved`.
10. Сценарий застрахованного: отправить чек (загрузка тестового JPEG с EXIF), проверить, что загруженный файл перекодирован без EXIF, и увидеть статус.
11. Четыре глаза: андеррайтер не может подтвердить свой запрос на лимит.
12. Тайм-аут неактивности (с подменой таймеров): предупреждение, затем выход.

---

## 12. CI и деплой

### 12.1 GitHub Actions — `.github/workflows/ci.yml`

На push и pull request:
1. `actions/checkout`, `actions/setup-node` (Node 20, кэш npm), `npm ci`.
2. `npm run typecheck`, `npm run lint`, `npm run test`.
3. `npm run build`.
4. `npx playwright install --with-deps chromium`, `npm run test:e2e`.
5. `npm audit --audit-level=high`.
6. Gitleaks (`gitleaks/gitleaks-action@v2`).

Отчёт Playwright загружается как артефакт при падении.

### 12.2 Cloudflare Pages (делает человек, не Claude Code)

1. Cloudflare → Workers & Pages → Create → Pages → подключить репозиторий GitHub.
2. Build command `npm run build`, output `dist`, Node 20.
3. Переменные окружения: `VITE_USE_MOCKS=true`, `VITE_DEMO_MODE=true`.
4. Закрыть доступ: Cloudflare Zero Trust → Access → Applications → Self-hosted → домен проекта `*.pages.dev`. Политика: разрешить только перечисленные email коллег (вход по одноразовому коду на почту).
5. После деплоя проверить заголовки на securityheaders.com.

---

## 13. Чеклист сборки (один проход)

Выполняй подряд, не останавливаясь. Отмечай `[x]` по мере готовности.

- [ ] 1. Инициализация: Vite + React + TS, строгий `tsconfig`, алиас `@/` → `src/`, ESLint с правилами §9.1, Prettier, Tailwind, shadcn/ui, шрифты @fontsource, `.gitignore`, `.env.example`, скрипты `package.json`.
- [ ] 2. `public/_headers`, `_redirects`, `robots.txt`, настройки Vite из §9.3, `npx msw init public`.
- [ ] 3. `src/styles/tokens.css` с двумя темами, базовые стили, фокус, reduced-motion.
- [ ] 4. Типы `src/shared/types/` и DTO.
- [ ] 5. `src/shared/lib/`: format, safeUrl, redirect, csv, logger, storage, image (перекодирование и проверка файлов), и юнит-тесты к ним.
- [ ] 6. `src/shared/auth/`: permissions (матрица и тесты), session, guards, тайм-аут, выход между вкладками.
- [ ] 7. `src/shared/api/client.ts` (fetch, Bearer, обработка ApiError, 401 → выход, zod-валидация ответов) и хуки запросов по всем эндпоинтам §6.2.
- [ ] 8. Мок: генератор, seed по §6.3, БД в памяти, requireSession, requirePermission, маскирование, аудит, задержки и сбои, все обработчики §6.2, сброс, XSS-seed по флагу.
- [ ] 9. Общие компоненты: каркасы трёх порталов, таблица с сортировкой, пагинацией и клавиатурой, боковая панель, фильтры-метки, скелетоны, пустые состояния и ошибки, тосты, модалка подтверждения, модалка reveal, поле-маска, загрузчик файлов, командная палитра.
- [ ] 10. Вход: все экраны §8.1, `?next=`, блокировка после неудачных попыток.
- [ ] 11. Демо-модуль `src/demo/`: баннер, «Войти как…», сброс, тумблер сбоев, подсказки на входе.
- [ ] 12. Портал сотрудников: все экраны §8.2.
- [ ] 13. Кабинет HR: все экраны §8.3.
- [ ] 14. Приложение застрахованного: все экраны §8.4, i18n RU/UZ.
- [ ] 15. Страницы 403, 404, ErrorBoundary, баннер офлайна.
- [ ] 16. Компонентные тесты §11.
- [ ] 17. E2E-тесты §11, все 12 сценариев.
- [ ] 18. CI `.github/workflows/ci.yml`, `.github/dependabot.yml`.
- [ ] 19. `README.md`: что это, как запустить, демо-аккаунты, как устроены моки, как потом подключить настоящий API (заменить `VITE_USE_MOCKS=false` и `VITE_API_BASE_URL`), деплой по §12.2.
- [ ] 20. Полный прогон `npm run check`, исправление всего до зелёного.
- [ ] 21. Самопроверка: пройти по §8 экран за экраном и убедиться, что каждая кнопка работает и каждый список фильтруется. Найденное исправить.
- [ ] 22. Отчёт по §14.

---

## 14. Готово — и что вывести в конце

Проект готов, когда:
- все пункты §13 отмечены;
- `npm run check` проходит без ошибок и предупреждений;
- каждый экран из §3 открывается под своими ролями и закрыт для остальных;
- все сценарии из §11 зелёные.

Итоговый отчёт в чате:
1. Что собрано: порталы, число экранов, эндпоинтов и тестов.
2. Как запустить локально и какие демо-аккаунты есть.
3. Список решений из `docs/DECISIONS.md`.
4. Что не сделано или сделано упрощённо, и почему (если есть).
5. Что понадобится от бэкенда, чтобы заменить мок: перечень эндпоинтов с типами — это будет ТЗ для FastAPI.
