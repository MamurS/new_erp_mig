# База данных: соглашения для бэкенда

Источник правды — закоммиченные миграции `supabase/migrations/*.sql`, сгенерированные из
`packages/domain/src/store/schema.ts` (`npm run db:gen`, см. README «База данных»). Права по таблицам —
`docs/backend/RLS.md` (тоже генерируется).

## Миграции

| Файл | Что внутри |
|---|---|
| `…0100_app_core.sql` | расширения `pgcrypto`, `pg_trgm`; схема `app`: claims запроса (`uid`, `role`, `company_id`, `clinic_id`, `assistance_id`, `insured_id`, `aal`), `is_staff/is_clinic/is_assist`, `needs_aal2`, `active`, матрица `app.permissions` и `can/can_any/rule`, `app.pos_seq`, триггер `app.stamp()` |
| `…0200_schema.sql` | таблицы всех коллекций, CHECK перечислений, уникальные номера, индексы списков, внешние ключи (`DEFERRABLE INITIALLY DEFERRED`), последовательности номеров документов `seq_kp`, `seq_guarantee`, `seq_case`, `seq_deal`, `seq_contract` |
| `…0300_app_scopes.sql` | функции «своего» для политик, `app.reveal()`, представление `insured_masked` |
| `…0400_rls.sql` | `enable row level security` и политики всех таблиц, привилегии `authenticated` (без `anon`), привилегии на колонки |
| `…0500_audit.sql` | цепочка хэшей `audit_log`, запрет изменения, `app.audit()`, `app.verify_audit_chain()` |
| `…0600_jobs.sql` | `app.job_catalog`, `app.job_queue`, `app.job_cleanup_expired()`, `app.job_verify_audit_chain()`, регистрация в pg_cron (если расширение есть) |

Новое изменение схемы — новый файл миграции (новая функция-раздел в `migrations.ts` с новым именем), а не
правка старого после выката на staging.

## Строки ↔ колонки (репозитории postgres, шаг 4)

Реализация — `packages/domain/src/store/postgres.ts` (SQL) поверх `SqlSession` API (`apps/api/src/db.ts`); правила
ниже она соблюдает, а тест соответствия `apps/api/src/conformance.test.ts` сверяет её с репозиториями в памяти.

- `packages/domain/src/store/sql/physical.ts`: `fieldMappings(collection)` — для каждого поля типа строки
  его колонки, вид (`uuid`, `text`, `int`, `bigint`, `float`, `bool`, `date`, `ts`, `epoch`, `json`, `textArray`,
  `enum`, `virtual`), обнуляемость; `jsonFields`, `keyColumn`, `readableColumns`, `qi` (кавычки для `from`, `to`).
- `NULL` читается как отсутствующее свойство, кроме полей `x: T | null` (`nullAsNull`) — там `null`.
- `ts` ↔ `timestamptz`: в домене строки вида `2026-09-29T14:21:00+05:00`; при чтении форматировать в
  Asia/Tashkent (`app.tz()`) с `+05:00`. `date` ↔ `YYYY-MM-DD`. `epoch` — миллисекунды в `bigint`.
- Деньги — `bigint` (целые сумы), доли и коэффициенты — `double precision`.
- `virtual`: пароли (Supabase Auth) и байты файлов (Storage) в таблицах не хранятся.
- Порядок: `insert(…, { at: 'start' })` → `_pos = -nextval('app.pos_seq')`, иначе значение по умолчанию;
  `list()` без явной сортировки — `order by _pos`.
- Синглтоны: `dms_param_values` (ключ → значение), `ai_settings` и `integrations_seed` (одна строка, `id = 1`),
  `ai_rebill_flags`, `statement_keys`; `seq.next(name)` = `nextval('public.seq_<name>')`.

## Персональные данные

- `pinfl`, `phone` (застрахованные), `pinfl` (заявки на членов семьи): `*_enc` (AES-256-GCM в API),
  `*_key_ver`, `*_hmac` (HMAC-SHA-256 отдельным ключом — поиск по равенству), `*_mask` (маска, которую API
  пишет вместе с шифротекстом). `*_enc`/`*_key_ver` не читаются ролью `authenticated`; полное значение —
  `select * from app.reveal('insured', :id, 'pinfl', :reason)` (проверка права и видимости, запись в аудит).
- Шифруются без HMAC: `chat.text`, `cases.description/resolution`, `claims.opinion`, `policy_changes.new_person`,
  `change_requests.new_person`, `contract_insured.rows`, `migration_batches.files`, `webhooks.signing_secret`.
- Карта выплат — только `payout_card_mask` и `payout_card_token` (токен банка, этап 2).
- `key_ver = 0` — открытый текст dev-seed; в рабочем окружении такого быть не должно.

## Права

- API выполняет запрос пользователя в транзакции: `set local role authenticated;
  select set_config('request.jwt.claims', :claims, true)`; claims — `{ sub, aal, app_metadata: { role,
  company_id | clinic_id | assistance_id | insured_id } }`.
- Побочные эффекты чужих для роли таблиц и аутентификация — через `systemDb` (сервисная роль), см. RLS.md.
- Аудит пишет только `app.audit(action, target_type, target_id, target_label, reason, assistance_id,
  actor_name, actor_id, actor_role, at, id, pos)`; у пользователя автор берётся из claims; `pos` — порядок хранения
  (`-nextval('app.pos_seq')` для записи «в начало»). Работать в READ COMMITTED (цепочка хэшей).

## Фоновые задачи

Расписания — `packages/domain/src/services/jobs.ts` (UTC). `db`-задачи pg_cron выполняет сам;
`api`-задачи попадают в `app.job_queue` (`taken_at`/`done_at`/`error` заполняет API).

## Проверка планов

На объёмах seed (1547 застрахованных, 626 убытков) списки под RLS используют индексы: убытки по статусу —
`claims_status_idx`, застрахованные компании — `insured_client_id_idx`, список HR через `insured_masked` —
`insured__pos_idx`; поиск по ФИО (`ilike`) на таком объёме идёт последовательным сканированием, на больших —
GIN-индекс `insured_full_name_trgm_idx`. Время выполнения — единицы миллисекунд.
