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
| `20261010000100_auth_sessions.sql` | BFF-сессии `public.app_sessions` и шаги входа `public.app_auth_challenges` (RLS без политик — только сервисная роль); очередь синхронизации с Supabase Auth `app.identity_sync` и триггеры на `staff`, `hr_users`, `clinic_users`, `assist_users`, `insured`; Custom Access Token Hook `public.custom_access_token_hook`; `app.job_cleanup_expired()` с очисткой BFF-сессий, шагов входа и выполненных заданий |
| `20261010000200_files_storage.sql` | у `files` колонки `bucket`, `object_name`, `sha256`, `size_bytes`; приватные бакеты Storage `receipts`, `contract-scans`, `guarantee-attachments`, `documents`, `help-assets` (если схема Storage есть; иначе их создаёт API при старте) |

| `20261012000100_list_queries.sql` | списки в SQL (раздел «Списки в SQL» ниже): коллации `app.ru`, `app.legal_name`; функции `app.search_key`, `app.claim_reserve`, `app.list_client_insured_counts`, `app.assist_policy_ids`; сгенерированные колонки ключей поиска `*_sk` с trigram-индексами; составные индексы списков; политика `insured_select` для ассистанса через `app.assist_policy_ids()` |

Генератор миграций части 2 — `packages/domain/src/store/sql/migrationsAuth.ts` (те же `node scripts/gen-schema.mjs` и
тест сверки).

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
- Шифрование — AES-256-GCM (`packages/domain/src/store/piiAes.ts`, Node `crypto`): `*_enc` = IV (12 байт) ‖ шифротекст ‖
  тег (16 байт), `*_key_ver` — версия ключа из `PII_KEYS`; новые значения — текущей версией (`PII_KEY_CURRENT`), старые
  читаются, пока их ключ есть в `PII_KEYS` (ротация — новая версия ключа, перешифрование старых строк — отдельной задачей).
- `supabase/seed.sql` зашифрован опубликованным dev-ключом версии 1 (IV выводится из значения, файл стабилен) и HMAC на
  dev-ключе; открытых ПДн в файле нет. Production не запускается с dev-ключами.
- `key_ver = 0` — открытый текст старого dev-seed: читается только вне production (`allowPlaintextV0`).

## Файлы

- Байты — в приватном бакете Supabase Storage, имя объекта — id строки `files` (UUID, без ПДн); строка хранит `bucket`,
  `object_name`, `sha256` (хэш сохранённых байтов: повторы чеков, целостность сканов) и `size_bytes`. Бакет — по строке:
  чеки и вложения убытков — `receipts`, вложения ГП — `guarantee-attachments`, сканы договоров и ДС — `contract-scans`,
  остальное — `documents`.
- Репозиторий postgres пишет объект до строки (откат запроса оставляет лишь объект без строки, его никто не отдаёт) и
  читает байты только в `files.get`; списки байты не грузят.

## Сессии и вход (часть 2 шага 4)

- `app_sessions`: HMAC идентификатора из cookie (`SESSION_SECRET`), пользователь, роль, AAL, access- и refresh-токены
  Supabase (зашифрованы ключом ПДн), срок access-токена, `auth_session_id` (сессия Supabase), создание, последняя
  активность, IP, user-agent. Каждая строка продолжает строку `public.sessions` (FK `on delete cascade`): сервисы
  завершают сессии там (выход, деактивация), и BFF-строка уходит вместе с ней.
- `app_auth_challenges`: шаг входа между паролем и TOTP-кодом (токены aal1 зашифрованы) или между телефоном и SMS-кодом
  (телефон зашифрован); попытки, ключ блокировки, срок 5 минут.
- `app.identity_sync`: учётные записи, которые Supabase Auth должен догнать (новая, роль, привязка, e-mail, телефон,
  деактивация); выполняет воркер API. Загрузка seed очереди не создаёт (`set_config('mig.seeding', 'on')`).

## Права

- API выполняет запрос пользователя в транзакции: `set local role authenticated;
  select set_config('request.jwt.claims', :claims, true)`; claims — `{ sub, aal, app_metadata: { role,
  company_id | clinic_id | assistance_id | insured_id } }`.
- Побочные эффекты чужих для роли таблиц и аутентификация — через `systemDb` (сервисная роль), см. RLS.md.
- Аудит пишет только `app.audit(action, target_type, target_id, target_label, reason, assistance_id,
  actor_name, actor_id, actor_role, at, id, pos)`; у пользователя автор берётся из claims; `pos` — порядок хранения
  (`-nextval('app.pos_seq')` для записи «в начало»). Работать в READ COMMITTED (цепочка хэшей).

## Списки в SQL (List queries)

Списки отдают страницу, порядок и итог из базы: сервисы строят запрос репозитория
(`packages/domain/src/store/query.ts`), Postgres-репозиторий превращает его в `WHERE … ORDER BY … LIMIT … OFFSET` и
`count(*)`, репозиторий в памяти выполняет тот же запрос в JS с тем же результатом (тест соответствия).

- **Порядок.** Термы `{ field, dir, nulls, collate, ifNull }`; строки без значения — в конце в обоих направлениях
  (`nulls last`), если не сказано иное; последний ключ всегда `_pos` (`ties: 'desc'` — `_pos desc`).
- **Сравнение текста.** `collate: 'ru'` — `app.ru` (ICU `ru`, как `localeCompare(…, 'ru')`), `collate: 'legal'` —
  `app.legal_name` (ICU `en-u-ks-level1-ka-shifted`, как `legalNameCollator`: регистр, кавычки и пунктуация не
  различаются), по умолчанию — `"C"` (кодовые точки). Обе ICU-коллации недетерминированные: равные для ICU строки —
  ничья, её решает `_pos`.
- **Поиск.** `{ field: { search: term } }` — подстрока ключа `searchKey` (транслитерация, апострофы, фонетика):
  колонка `<колонка>_sk text generated always as (app.search_key(<колонка>)) stored`, GIN-индекс `gin_trgm_ops`,
  условие `LIKE '%ключ%'` (ключ запроса считает API той же функцией JS). Поля с ключами — `LIST_QUERIES` в
  `schema.ts`. Зашифрованные ПДн (ПИНФЛ, телефон) ищутся только по равенству через `*_hmac`.
- **Вычисляемые поля** (`store/computed.ts`) — производные значения для фильтров и сортировок: SQL-выражение над
  строкой (подзапросы идут под RLS читающего; то, что RLS скрыл бы, — через узкие факты `app.*`) и двойник для памяти.
  Резерв убытка — `app.claim_reserve(history, reserve_history, amount_claimed, amount_approved)`.
- **Индексы списков** — `LIST_QUERIES[…].indexes`: (колонки фильтра, колонка сортировки с её коллацией, `_pos`),
  имя `<таблица>_<колонки>_list_idx`.
- **Страница** — `pageOf()` в `services/list.ts`: `LIMIT pageSize OFFSET (page-1)·pageSize`; `count(*)` не нужен, если
  страница неполная. Партнёрский API — курсор (смещение) и одна строка сверх страницы.
- **RLS ассистанса на `insured`** — `policy_id = any((select app.assist_policy_ids())::uuid[])`: массив полисов с
  доступом (`app.assist_access`) считается один раз на запрос, а не на каждую строку ростера.
- Новое поле в списке: если по нему ищут — добавить его в `LIST_QUERIES[…].search`; если сортируют по производному
  значению — вычисляемое поле с двумя определениями и тест в `apps/api/src/listQueries.test.ts`, если у него есть
  SQL-функция-двойник.

## Фоновые задачи

Расписания — `packages/domain/src/services/jobs.ts` (UTC). `db`-задачи pg_cron выполняет сам;
`api`-задачи попадают в `app.job_queue` (`taken_at`/`done_at`/`error` заполняет воркер API: `apps/api/src/jobs/worker.ts`,
сервисы — `packages/domain/src/services/jobRunner.ts`; строки берутся `for update skip locked`).

## Проверка планов

Списки после переноса в SQL (раздел выше): страница застрахованных (`/insured`, 1 547 строк) — `LIMIT 25` по индексу
`insured_full_name_ru_list_idx` за единицы миллисекунд вместо чтения и расшифровки
всей таблицы в API; ростер ассистанса — один массив полисов на запрос вместо `app.assist_access` на строку
(~300–450 мс → десятки мс). Замеры по спискам — `docs/backend/LOAD.md`, «Списки в SQL».

На объёмах seed (1547 застрахованных, 626 убытков) списки под RLS используют индексы: убытки по статусу —
`claims_status_idx`, застрахованные компании — `insured_client_id_idx`, список HR через `insured_masked` —
`insured__pos_idx`; поиск по ФИО (`ilike`) на таком объёме идёт последовательным сканированием, на больших —
GIN-индекс `insured_full_name_trgm_idx`. Время выполнения — единицы миллисекунд.
