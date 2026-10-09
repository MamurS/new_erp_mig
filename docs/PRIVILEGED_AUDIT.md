# Аудит привилегированного доступа (обход RLS)

В API запрос выполняется под ролью `authenticated` с claims человека, и каждую строку проверяет RLS. Привилегированный доступ — это всё, что идёт мимо RLS под сервисной ролью: `systemRepos(ctx, причина)` / `asSystem(ctx, причина)` (`ctx.system`, `packages/domain/src/services/kernel.ts`), `privileged()` и системная сессия `RequestTx.system()` (`apps/api/src/db.ts`), а также операции, которые репозитории Postgres выполняют привилегированно сами (`packages/domain/src/store/postgres.ts`). В моке (MSW, `store/memory.ts`) RLS нет, поэтому `systemRepos` там возвращает те же репозитории.

Документ перечисляет все такие места на момент начала работы (коммит `d14365a`) и решение по каждому. Номера строк в колонке «Место» — исходные (`d14365a`), в колонке «Где теперь» — текущие.

## Итог

| | До | После |
|---|---|---|
| Вызовы `systemRepos`/`asSystem` в `packages/domain/src` (без тестов и `kernel.ts`) | 63 | 16 |
| …из них в обработчиках запросов и сервисах вне разрешённых модулей | 63 | 0 |
| Места `privileged()`/`system()`/`privileged: true` в API и хранилище | 8 | 7 |
| Всего строк аудита (места до начала работы) | 71 | 22 осталось системными |

Из 71 места 49 переведены на работу от имени пользователя, ещё одно (№ 3) — частично: пересчёт счёта идёт от имени читателя, а системным осталось только сохранение пересчитанного результата (задача при чтении). Так получились 50 переведённых строк. Механизмов перевода три: новые политики RLS, узкие функции SQL (`app.fact_*`) и проверки под RLS самого пользователя.

Оставшиеся 16 вызовов в домене лежат только в разрешённых модулях:

- `services/system/clocks.ts` — фоновые задачи «часов» (этап 1.5): `timeClocks` (задача `contract-lifecycle` каждые 15 минут: договоры — вступление в силу и истечение, полисы, гарантийные письма, статусы счетов), `edoEvents` (опрос оператора ЭДО на каждом проходе фонового обработчика), `refreshContract` (часы одного договора — для этих задач и записей, которым нужен текущий статус: оплата, подпись); при чтении остались только сохранение пересчитанного счёта ассистанса (№ 3) и ежемесячная выборка контроля качества (№ 16);
- `services/system/consequences.ts` — 3 последствия действия, затрагивающие другие роли;
- `services/system/outbox.ts` — исходящие вебхуки;
- `services/migration.ts` — перенос портфеля, 5 вызовов;
- `http/demoRoutes.ts` — демо-маршрут.

В API системными остались вход и BFF-сессии, синхронизация ролей в Supabase Auth, задачи (`systemDb`), партнёрский API, служебный слой транзакции и репозиториев Postgres.

ESLint (`no-restricted-syntax` в `eslint.config.js`) запрещает `systemRepos(`, `asSystem(`, `.privileged(` и `.system(`/`privileged: true` в `packages/domain/src/**` и `apps/api/src/**`, кроме явного списка файлов `PRIVILEGED_ALLOWLIST`:

- `services/kernel.ts`;
- `services/system/**`;
- `services/migration.ts`;
- `http/demoRoutes.ts`;
- `store/postgres.ts`;
- `apps/api/src/db.ts`, `systemDb.ts`, `auth/**`, `jobs/**`.

Для `apps/api/src/app.ts` действует более узкое правило: в нём разрешена только системная сессия входа и партнёрского API.

### Чем заменён привилегированный доступ

**Узкие функции** (`supabase/migrations/20261011000100_app_facts.sql`, генерируются из `packages/domain/src/store/sql/facts.ts`). Устройство каждой:

- `SECURITY DEFINER`, `search_path = ''`;
- проверяет `app.active()`, а также право или область вызывающего, иначе ошибка 42501;
- возвращает только нужное значение.

У каждой функции есть двойник на TypeScript (`genericFacts` в `store/facts.ts`), который работает в моке и в системных репозиториях API. Тест соответствия проверяет, что двойники дают одинаковый результат. В репозиториях функции доступны как `Repos.facts`. Тесты pgTAP — `supabase/tests/04_privileged_test.sql` (генерируется `node scripts/gen-rls-tests.mjs`): у каждой функции проверены и разрешённый вызов, и отказ другой компании или роли.

Функции:

- `app.fact_client_insured_count`, `app.fact_client_legal_form`;
- `app.fact_client_claim_figures`, `app.fact_client_invoice_figures`, `app.fact_policy_brief`, `app.fact_client_history`, `app.fact_client_pipeline`;
- `app.fact_company_claim_count` (HR, k-анонимность);
- `app.fact_person_access_log`, `app.fact_own_audit_entries`;
- `app.fact_advance_deal`, `app.fact_push_clinic_event`, `app.fact_append_client_log` (запись в чужую ленту или журнал);
- `app.fact_redeem_card_token`, `app.fact_match_policy_pinfl` (проверка пациента до визита);
- `app.fact_visit_patient`, `app.fact_visit_policy_period`, `app.fact_policy_routing`;
- `app.fact_file_kind`;
- `app.fact_limit_sums`, `app.fact_coverage_brief`;
- `app.fact_taken_slots`;
- `app.fact_certificate_data`, `app.fact_mig_signatory`, `app.fact_deal_number`, `app.fact_contract_quote`;
- `app.fact_assistance_kpi_figures`, `app.fact_assistance_fee_figures`, `app.fact_assistance_list_figures`, `app.fact_assistance_report_figures`, `app.fact_assist_desktop_counters`, `app.fact_assistance_clients`;
- `app.fact_partner_integration_figures`, `app.fact_clinic_card_figures`;
- `app.fact_receipt_twins`;
- `app.fact_rebill_line_facts`, `app.fact_rebill_deciders`, `app.fact_link_cases_to_claim`, `app.fact_set_client_loss_ratio`.

Служебная `app.roster_of` пользователям недоступна.

**Новые и расширенные политики RLS** (`packages/domain/src/store/schema.ts`; миграции `…_rls.sql`/`…_app_scopes.sql` и тесты pgTAP сгенерированы `npm run db:gen`):

| Таблица | Изменение |
|---|---|
| `documents` | select: и для ролей с `policies.read` (документы клиента в карточке полиса) |
| `card_tokens` | select/insert/delete застрахованного: `insured_id = any(app.my_card_ids())` — сам и активная семья под ним |
| `webhook_deliveries` | новая политика UPDATE: администратор интеграции клиники или ассистанса — свои доставки (ручной повтор) |
| `deal_events` | INSERT для HR: `app.client_of_deal(deal_id) = app.company_id()` |
| `price_lists` | select: любой пользователь ассистанса (`always`) |
| `clinic_contracts` | select: любой пользователь ассистанса — только свои договоры (`payer = app.assistance_id()`) |
| `contracts` | select и update для HR: также черновик своей компании, пока открыт запрос МИГ на приложение 2 (`app.hr_asked_contract(id)`) |
| `payments` | select: и роли с `contracts.read` (платежи в карточке договора) |
| `insured`, `policies` | select ассистанса: `app.assist_access(policy) <> 'none'` — сегодняшнее назначение или 12 месяцев только чтения после его окончания |
| `appointments` | select ассистанса: по назначению на дату заявки (`app.assist_scope(…, created_at)`), действия дополнены `assist.insured.search` |
| `guarantees` | INSERT ассистанса: письмо по направлению для полиса, который компания обслуживает сегодня, — `assistance_id = app.assistance_id() and app.assist_scope(policy_id, …) = 'full'` |
| `clinic_users` | select: и сотрудники МИГ с `clinics.read` |
| `assist_users`, `integration_clients` | select: любой сотрудник МИГ (карточки партнёров), `secret_hash` по-прежнему закрыт привилегиями колонок |
| `cases` | select: любой сотрудник МИГ — только требующие внимания (не закрыты, жалоба или просрочка SLA) |
| `rebills` | select: любой сотрудник МИГ — кроме черновиков |
| `qa_samples` | select: любой сотрудник МИГ |
| `ai_rebill_flags` | insert/update/delete: проверяющий счета ассистансов (`rebills.review`); репозиторий больше не пишет флаги сервисной ролью |

Новые функции-помощники политик (`app_scopes`, SECURITY DEFINER): `client_of_deal`, `my_card_ids`, `hr_asked_contract`, `today`, `add_months`, `policy_of_insured`, `assistance_on`, `assist_scope_of`, `assist_scope`, `assist_access`. Генератор политик теперь допускает для группы ролей несколько областей, у каждой свои действия-ворота.

### Найденные и исправленные ошибки

- **Свободные слоты и проверка «слот занят».** Под RLS обе видели только записи самого пользователя, поэтому застрахованный мог записаться на занятое время. Теперь используется `app.fact_taken_slots`: функция возвращает только время. Ошибку поймал тест соответствия, который падал в зависимости от времени суток.
- **Доступ бывшего ассистанса.** Ассистанс, обслуживавший полис раньше, по правилу домена 12 месяцев читает человека, полис и заявки. В Postgres это не работало: RLS их скрывал, и карточка падала. Теперь доступ задают `app.assist_access` и `app.assist_scope` в политиках.
- **Карточка застрахованного у врача ассистанса** показывала записи только в моке. Исправлено политикой `appointments` с `assist.insured.search`.

### Изменения поведения

- Запрос застрахованного на код карты больше не удаляет просроченные токены других людей, а только свои. Чужие удаляет ежедневная задача `app.job_cleanup_expired`.
- Флаги мошенничества сравнивают новый убыток только с возможными дубликатами того же чека: совпадение по фискальному признаку, по изображению или по сумме и дате. Эти убытки возвращаются без указания человека («other»). Остальные убытки самого застрахованного читаются под его RLS. Результат проверки не изменился.

## Все места

Обозначения в колонке «Контекст»:

- **Запрос (роль)** — обработчик запроса пользователя;
- **Часы** — задача при чтении: состояние, которое меняется со временем, сохраняет первый, кто прочитал;
- **Последствие** — переход бизнес-процесса, который действие одной роли вызывает в строках других ролей;
- **Перенос** — миграция портфеля;
- **Вход** — вход и выдача ролей;
- **Задача** — фоновая задача;
- **Демо** — демо-маршрут (staging/ci);
- **Партнёр** — партнёрский API.

| № | Место (до) | Функция | Причина | Контекст | Как пользователь? | Решение | Где теперь |
|---|---|---|---|---|---|---|---|
| 1 | `http/demoRoutes.ts:78` | демо: код карты пациента для симулятора МИС | токен карты чужого человека | Демо | нет, демо | **оставлено системным**: маршрут существует только при `demoRoutes` (staging/ci) | `http/demoRoutes.ts:78` (allowlist) |
| 2 | `services/ai.ts:81` | `check` → `contextOf` | полис, программа и лимиты проверяемого человека, которых клиника или ассистанс не видят | Запрос (клиника, ассистанс, МИГ, застрахованный) | да | **узкие функции**: `app.fact_coverage_brief` (срок и программа полиса, даты человека) и `app.fact_limit_sums` (только суммы по категориям) | `services/ai.ts` (`contextOf`), `services/limits.ts` |
| 3 | `services/assistPortal.ts:184` | `toRebillView` | пересчёт проверок и вознаграждения по чужим данным, сохранение, имена сотрудников МИГ | Запрос (ассистанс, проверяющие МИГ, карточка ассистанса) | частично | **пересчёт от имени читателя** (`app.fact_rebill_line_facts`, `app.fact_assistance_fee_figures`, лимиты, маршрутизация); имена — `app.fact_rebill_deciders`; **сохранение пересчитанного счёта оставлено системным** как задача при чтении: читатель (врач ассистанса, оператор МИГ) не может обновлять счёт | `services/assistPortal.ts` (`toRebillView`), `services/system/clocks.ts:30` (`saveRecomputedRebill`) |
| 4 | `services/assistPortal.ts:231` | `appointmentsOf` | заявки людей ассистанса по назначению на дату заявки, включая бывший (12 месяцев) | Запрос (ассистанс) | да | **RLS**: `appointments` для ассистанса по `app.assist_scope` от даты заявки, `insured` — по `app.assist_access`; фильтр сервиса тот же | `services/assistPortal.ts` (`appointmentsOf`) |
| 5 | `services/assistPortal.ts:376` | `overview` | счётчики стола одинаковы для всех ролей компании, а таблицы видны не всем | Запрос (все роли ассистанса) | да | **узкая функция** `app.fact_assist_desktop_counters` (только числа); очередь — из таблиц, которые видит роль | `services/assistPortal.ts` (`overview`) |
| 6 | `services/assistPortal.ts:727` | `requestGuaranteeOnCall` → `createGuarantee` | ГП по направлению — строка клиники | Запрос (оператор ассистанса) | да | **RLS**: политика INSERT `guarantees` для ассистанса — своя компания, полис, который она обслуживает сегодня | `services/assistPortal.ts` |
| 7 | `services/assistPortal.ts:837` | `clinics` (`ownPrices`) | договор клиники с плательщиком | Запрос (все роли ассистанса) | да | **RLS**: `clinic_contracts` — любой пользователь ассистанса видит свои договоры | `services/assistPortal.ts` |
| 8 | `services/assistance.ts:44` | `assignmentsOf` | назначения всех компаний на полис (маршрутизация) | Запрос (застрахованный, клиника, ассистанс, МИГ) | да | области ассистанса — по своим назначениям под RLS (`assignmentsOf`); «кто обслуживает полис на дату» — **узкая функция** `app.fact_policy_routing` (без автора назначения; застрахованному — свой полис, HR — полисы компании, клинике — полисы её пациентов, ассистансу — обслуженные им) | `services/assistance.ts` (`assignmentsOf`, `routingOf`) |
| 9 | `services/assistance.ts:64` | `syncAssistance` | кэш назначения в полисах и клиентах | Запрос (андеррайтер назначает ассистанс), Перенос, Часы | да | **от имени пользователя**: андеррайтер читает и меняет полисы и клиентов; из переноса и часов функция вызывается с системным контекстом вызывающего | `services/assistance.ts` |
| 10 | `services/assistance.ts:116` | `rosterOf` | люди полисов, назначенных компании сегодня | Запрос (ассистанс), агрегаты | да | свои назначения под RLS + проверка маршрутизации `app.fact_policy_routing` + люди под RLS (`assist_access`); агрегаты для МИГ — функции № 15, 52 | `services/assistance.ts` (`rosterOf`) |
| 11 | `services/assistance.ts:128` | `insuredOfVisit` | пациент визита и после закрытия визита | Запрос (клиника — строки реестра, ИИ; МИГ; ассистанс) | да | **узкая функция** `app.fact_visit_patient` (id, имя, полис — только по видимому визиту) | `services/assistance.ts` |
| 12 | `services/assistance.ts:231` | `checksFor` | данные МИГ по строке счёта | Запрос (ассистанс, проверяющие МИГ) | да | **узкая функция** `app.fact_rebill_line_facts`: строка, сроки полиса и человека, цены, одобренное ГП, дубликаты, флаг ИИ — без имени; ассистансу только его строки. Лимит — `app.fact_limit_sums`, назначение — `app.fact_policy_routing` | `services/assistance.ts` (`checksFor`) |
| 13 | `services/assistance.ts:290` | `feeOf` | число людей и случаев компании за месяц | Запрос (биллинг ассистанса, МИГ) | да | **узкая функция** `app.fact_assistance_fee_figures` | `services/assistance.ts` |
| 14 | `services/assistance.ts:358` | `claimsFromRebill` | убытки из принятых строк, ссылка в случаях ассистанса, убыточность клиента | Запрос (проверяющий МИГ) | да | **от имени проверяющего** (убытки, реестры, визиты, люди под его RLS); ссылки случаев и убыточность клиента — **узкие функции записи** `app.fact_link_cases_to_claim` и `app.fact_set_client_loss_ratio` (значение считает сервис) | `services/assistance.ts` |
| 15 | `services/assistance.ts:407` | `kpiOf` | агрегаты по портфелю компании | Запрос (ассистанс, все сотрудники МИГ) | да | **узкая функция** `app.fact_assistance_kpi_figures` (числа и суммы) | `services/assistance.ts` (`kpiOf`) |
| 16 | `services/assistance.ts:438` | `ensureQaSample` | ежемесячная контрольная выборка решений всех ассистансов | Часы (при чтении очереди) | нет: пишет в очередь МИГ по всем компаниям | **оставлено системным**: задача при чтении | `services/system/clocks.ts:80` |
| 17 | `services/claims.ts:208` | `fileAccess` | 403 или 404 для файла, скрытого RLS, как в моке | Запрос (любой) | да | **узкая функция** `app.fact_file_kind`: только «есть ли» и «вложение ГП или нет», сам файл не отдаётся | `services/claims.ts` |
| 18 | `services/clients.ts:131` | `lossStats` | суммы и число убытков клиента для `clients.read` | Запрос (андеррайтер, продажи и др.) | да | **узкая функция** `app.fact_client_claim_figures` (категория, даты, статус, суммы — без номера и человека) | `services/clients.ts` |
| 19 | `services/clients.ts:157` | `clientDetail` | убытки по месяцам, последний счёт, полис | Запрос (`clients.read`) | да | **узкие функции** `app.fact_client_claim_figures`, `app.fact_client_invoice_figures`, `app.fact_policy_brief`; номер последнего убытка — собственным запросом роли с `claims.read` | `services/clients.ts` |
| 20 | `services/clients.ts:217` | `clientHistory` | записи аудита о клиенте, полисах, убытках, КП | Запрос (`clients.read`) | да | **узкая функция** `app.fact_client_history` (без раскрытий ПДн и медданных, без причин) | `services/clients.ts` |
| 21 | `services/clients.ts:285` | `policyDetail` (документы) | документы клиента в карточке полиса | Запрос (`policies.read`) | да | **RLS**: `documents` select и для `policies.read` | `services/clients.ts` |
| 22 | `services/clinic.ts:77` | `pushEvent` | лента кабинета клиники от событий любой стороны | Запрос (застрахованный, ассистанс, МИГ, клиника) | да | **узкая функция записи** `app.fact_push_clinic_event` (вставка и обрезка до 500; клиника пишет только в свою ленту) | `services/clinic.ts` |
| 23 | `services/clinic.ts:85` | `priceListOf` | прайс клиники для плательщика | Запрос (клиника, ассистанс, МИГ) | да | **RLS**: `price_lists` — любой пользователь ассистанса, `clinic_contracts` — свои договоры ассистанса | `services/clinic.ts` |
| 24 | `services/clinic.ts:108` | `coverageFor` | полис и лимиты пациента открытого визита | Запрос (клиника), Партнёр | да | человек — под RLS открытого визита; полис — `app.fact_coverage_brief`; лимиты — `app.fact_limit_sums` | `services/clinic.ts` |
| 25 | `services/clinic.ts:158` | `checkPatient` | код карты или полис + ПИНФЛ до визита | Запрос (клиника), Партнёр | да | **узкие функции** `app.fact_redeem_card_token` (одноразовое погашение, только id) и `app.fact_match_policy_pinfl` (сравнение по HMAC, только id); счётчики попыток — служебные таблицы API (№ 70) | `services/clinic.ts` |
| 26 | `services/clinic.ts:300` | `refreshStoredGuarantee` | ГП истекает по времени | Часы | нет: читатель (оператор МИГ) не может менять письмо | **убрано из чтения** (этап 1.5): истечение сохраняет фоновая задача `contract-lifecycle` (`timeClocks`); проверка строки реестра считает срок письма в памяти, без записи | `services/system/clocks.ts` (`timeClocks`) |
| 27 | `services/clinic.ts:371` | `lineProblems` | пациент и срок полиса по визиту клиники | Запрос (клиника), Партнёр | да | **узкая функция** `app.fact_visit_policy_period` | `services/clinic.ts` |
| 28 | `services/clinic.ts:537` | `emitWebhook` | конечные точки и секреты подписи партнёра, журнал доставок | Последствие (исходящий журнал) | нет: секрет подписи не читается человеком | **оставлено системным**: исходящие события | `services/system/outbox.ts:17` |
| 29 | `services/contracts.ts:123` | `freshInvoice` | статус счёта по дате | Часы | нет: HR не меняет счета | **убрано из чтения** (этап 1.5): статус по сроку сохраняет фоновая задача `contract-lifecycle` (`timeClocks`); оплата пересчитывает статус своего счёта сама | `services/system/clocks.ts` (`timeClocks`) |
| 30 | `services/contracts.ts:130` | `contractView` | сделка, котировка, подписанты, счета, платежи | Запрос (HR, сотрудники МИГ) | да | **узкие функции** `app.fact_deal_number`, `app.fact_contract_quote`, `app.fact_mig_signatory`; **RLS**: `payments` для `contracts.read`; остальное под RLS читателя (HR платежи и список подписантов не показываются) | `services/contracts.ts` |
| 31 | `services/contracts.ts:160` | `endorsementView` | договор, подписант МИГ, заявки на изменение | Запрос (HR, МИГ) | да | под RLS + `app.fact_mig_signatory` | `services/contracts.ts` |
| 32 | `services/contracts.ts:569` | `certificates` | номер договора, клиент, люди полиса | Запрос (МИГ, HR, застрахованный) | да | полис под RLS + **узкая функция** `app.fact_certificate_data` (застрахованному — только сертификат карты своей семьи) | `services/contracts.ts` |
| 33 | `services/contracts.ts:784` | `uploadInsuredList` (HR) | черновик договора скрыт от HR | Запрос (HR) | да | **RLS**: HR видит и заполняет черновик своей компании, пока открыт запрос МИГ (`app.hr_asked_contract`) | `services/contracts.ts` |
| 34 | `services/dashboard.ts:109` | KPI врача (свои раскрытия) | журнал аудита | Запрос (врач-эксперт) | да | **узкая функция** `app.fact_own_audit_entries` (только свои открытия медданных) | `services/dashboard.ts` |
| 35 | `services/dashboard.ts:693` | `medicalAccess` | последние раскрытия ПДн и медданных | Запрос (админ, врач) | да | админ читает журнал аудита по RLS (`audit.read`), врач — свои через `app.fact_own_audit_entries` | `services/dashboard.ts` |
| 36 | `services/deals.ts:610` | `respondKp` → `ensureRenewalDeal` | ответ клиента открывает сделку продления (сделки, сотрудники, нумерация) | Последствие | нет: HR не видит и не создаёт сделки МИГ | **оставлено системным** | `services/system/consequences.ts:77` (`openRenewalDeal`) |
| 37 | `services/hr.ts:388` | `stats` | число убытков компании за квартал (k-анонимность) | Запрос (HR) | да | **узкая функция** `app.fact_company_claim_count` (только число) | `services/hr.ts` |
| 38 | `services/insured.ts:130` | `accessLog` | раскрытия ПДн и медданных человека | Запрос (сотрудники МИГ с карточкой) | да | **узкая функция** `app.fact_person_access_log` | `services/insured.ts` |
| 39 | `services/lifecycle.ts:61` | `dealEvent` | лента сделки от событий любой стороны | Запрос (HR, сотрудники МИГ), Часы | да | **RLS**: политика INSERT `deal_events` для HR своей компании (`app.client_of_deal`) | `services/lifecycle.ts` |
| 40 | `services/lifecycle.ts:69` | `moveDeal` | стадия сделки от событий любой стороны | Запрос (HR, юрист, бухгалтер и др.) | да | **узкая функция записи** `app.fact_advance_deal` (только вперёд, не из «проиграна») | `services/lifecycle.ts` |
| 41 | `services/lifecycle.ts:173` | `afterSigning` | последствия подписи: статус, счета, вступление в силу, применение ДС | Последствие (подпись HR, ЭДО) | нет: HR не создаёт счета, полисы и застрахованных | **оставлено системным** | `services/system/consequences.ts:23` |
| 42 | `services/lifecycle.ts:232` | `refreshContract` | ЭДО, вступление в силу, истечение | Часы | нет | **убрано из чтения** (этап 1.5): `/deals`, `/contracts`, `/endorsements` и карточки показывают сохранённое; переходы — фоновая задача `contract-lifecycle` и опрос ЭДО (`edoEvents`); оплата и подпись вызывают часы своего договора в записи | `services/system/clocks.ts` (`refreshContract`, `timeClocks`, `edoEvents`) |
| 43 | `services/me.ts:252` | `cardToken` | код карты члена семьи | Запрос (застрахованный) | да | **RLS**: `card_tokens` по `app.my_card_ids()` (сам и активная семья) | `services/me.ts` |
| 44 | `services/migration.ts:41` | `dbRefs` | сверка со всеми клиентами, полисами, договорами, людьми, убытками | Перенос | нет | **оставлено системным**: миграция данных, утверждает второй администратор | `services/migration.ts:41` |
| 45 | `services/migration.ts:214` | `batchView` | сверка, договоры и препятствия отката пакета | Перенос | нет | **оставлено системным** | `services/migration.ts:214` |
| 46 | `services/migration.ts:294` | `applyBatch` | запись пакета во все таблицы | Перенос | нет | **оставлено системным** | `services/migration.ts:294` |
| 47 | `services/migration.ts:666` | `rollbackBlockers` | что случилось с перенесёнными записями | Перенос | нет | **оставлено системным** | `services/migration.ts:666` |
| 48 | `services/migration.ts:718` | `rollbackBatch` | откат пакета из всех таблиц | Перенос | нет | **оставлено системным** | `services/migration.ts:718` |
| 49 | `services/partnerIntegration.ts:133` | `retryDelivery` | запись повтора в журнал доставок | Запрос (администратор интеграции клиники или ассистанса) | да | **RLS**: новая политика UPDATE `webhook_deliveries` для своих доставок | `services/partnerIntegration.ts` |
| 50 | `services/policy.ts:167` | `refreshPolicyTotals` | счётчики полиса и клиента | Запрос (андеррайтер), Последствие, Перенос | да | **от имени пользователя**: андеррайтер меняет и полис, и клиента; из последствий и переноса — с системным контекстом вызывающего | `services/policy.ts` |
| 51 | `services/settlement.ts:60` | `refreshFlags` | сравнение со всеми убытками | Запрос (застрахованный, оператор, урегулирование) | да | **узкая функция** `app.fact_receipt_twins` (возможные дубликаты чека без человека) + свои убытки под RLS | `services/settlement.ts` |
| 52 | `services/staffAssistance.ts:105` | `listAssistances` | портфель, KPI, счётчики компаний | Запрос (любой сотрудник МИГ) | да | **узкие функции** `app.fact_assistance_list_figures`, `app.fact_assistance_kpi_figures` | `services/staffAssistance.ts` |
| 53 | `services/staffAssistance.ts:141` | `card` (ассистанс) | портфель, пользователи, ключи, счета, контроль качества, аудит | Запрос (любой сотрудник МИГ) | да | **узкие функции** `app.fact_assistance_clients`, `app.fact_partner_integration_figures`, `app.fact_assistance_list_figures`, KPI, вознаграждение; **RLS** для сотрудников МИГ: `assist_users`, `integration_clients`, `qa_samples`, `rebills` (кроме черновиков), `cases` (требующие внимания); аудит — по `audit.read` | `services/staffAssistance.ts` |
| 54 | `services/staffAssistance.ts:240` | `policyAssignments` | полис для сотрудников с `clients.read` | Запрос (МИГ) | да | назначения, сотрудники и компании под RLS; существование полиса — `app.fact_policy_brief` | `services/staffAssistance.ts` |
| 55 | `services/staffAssistance.ts:390` | `reportByAssistanceFor` | агрегаты по всему портфелю | Запрос (`reports.read`) | да | **узкая функция** `app.fact_assistance_report_figures` | `services/staffAssistance.ts` |
| 56 | `services/staffClinics.ts:64` | `card` (клиника) | пользователи, ключи, вебхуки, ошибки API, реестры | Запрос (`clinics.read`) | да | **узкие функции** `app.fact_clinic_card_figures`, `app.fact_partner_integration_figures`; **RLS**: `clinic_users` для `clinics.read`, `integration_clients` для сотрудников МИГ | `services/staffClinics.ts` |
| 57 | `services/tasks.ts:120` | `record` | лента сделки и журнал клиента от действия по запросу | Запрос (HR, сотрудники МИГ) | да | **RLS** `deal_events` (HR) + **узкая функция записи** `app.fact_append_client_log` | `services/tasks.ts` |
| 58 | `services/tasks.ts:235` | `sweepDeadlines` | флаг напоминания по задаче | Запрос (списки запросов), Задача | да | **от имени пользователя**: политика UPDATE `tasks` совпадает с SELECT | `services/tasks.ts` |
| 59 | `services/tasks.ts:256` | `completeTasks` | шаг закрывает открытые запросы к другим ролям | Последствие | нет: запросы к HR от других сотрудников и запросы к МИГ от HR скрыты политикой `tasks` | **оставлено системным** | `services/system/consequences.ts:60` |
| 60 | `services/tasks.ts:444` | `pipeline` | сделка, договор, счёт клиента | Запрос (`clients.read`) | да | **узкая функция** `app.fact_client_pipeline` | `services/tasks.ts` |
| 61 | `services/views.ts:23` | `insuredCountFor` | число застрахованных клиента | Запрос (любой, кто видит клиента) | да | **узкая функция** `app.fact_client_insured_count` | `services/views.ts` |
| 62 | `services/views.ts:28` | `clientLegalFormOf` | правовая форма рядом с названием | Запрос (МИГ, HR своей компании) | да | **узкая функция** `app.fact_client_legal_form` | `services/views.ts` |
| 63 | `services/views.ts:146` | `limitsFor` | заявки, ГП, строки реестров семьи | Запрос (застрахованный, клиника, ассистанс, МИГ) | да | **узкая функция** `app.fact_limit_sums`: только суммы по категориям. Внутри функции письма пула, истёкшие по времени, помечаются истёкшими — это «часы», как и раньше | `services/limits.ts` |
| 64 | `apps/api/src/app.ts:99` | `inTx`: системные репозитории запроса | поиск сессии и вход до появления claims; возможность `ctx.system` для разрешённых модулей | Вход | нет | **оставлено системным**; ESLint разрешает в `app.ts` только системную сессию, но не `privileged()`, `systemRepos` и `asSystem` | `apps/api/src/app.ts:99` |
| 65 | `apps/api/src/app.ts:150` | маршруты `auth: 'partner'` | партнёрский API выполняется системными репозиториями | Партнёр | нет: партнёр — не персона RLS, доступ ограничивают ключ и scope | **оставлено системным**; перевод требует отдельной роли ключа в матрице прав и claims ключа. Это этап 2: вместе с OAuth-партнёрами (DECISIONS) | `apps/api/src/app.ts:149` |
| 66 | `apps/api/src/app.ts:208` | `GET /files/:id/link` | где лежат байты файла | Запрос (любой) | да | **от имени пользователя**: строку файла `fileAccess` уже проверил по RLS | `apps/api/src/app.ts` |
| 67 | `apps/api/src/db.ts:114` | `RequestTx.system()` / `privileged()` | определение возможности | инфраструктура | — | **оставлено** (определение) | `apps/api/src/db.ts` (allowlist) |
| 68 | `apps/api/src/auth/bff.ts` (11 вызовов `tx.system()`) | вход, BFF-сессии, синхронизация ролей и привязок с Supabase Auth | таблицы сессий и вызовов без политик | Вход (выдача ролей) | нет | **оставлено системным** | `apps/api/src/auth/bff.ts` (allowlist) |
| 69 | `apps/api/src/systemDb.ts:22` | `systemDb` | задачи и обслуживание | Задача | нет | **оставлено системным** | `apps/api/src/systemDb.ts` (allowlist) |
| 70 | `store/postgres.ts:174` | `run(…, privileged)` | операции с таблицами без политик (`sessions`, `challenges`, `grants`, `lockouts`, `login_failures`, `check_attempts`, `check_locks`, `access_tokens`, `idempotency`, `api_calls`) и вставки в журналы, куда не пишет ни одна роль (`sms_outbox`, `api_logs`, `webhook_deliveries`, `clinic_events`, `qa_samples`); отметки фоновых задач `app.job_marks` (репозиторий `jobMarks`, этап 1.5: пишет только воркер) | служебное состояние API: счётчики, токены, журналы | Вход, Партнёр, Задача, Часы | нет | **оставлено**, сужено: `ai_rebill_flags` теперь под RLS (политики для `rebills.review`); `clinic_events` из запросов пишутся только через `app.fact_push_clinic_event`; из запросов людей привилегированно остаются только счётчики попыток проверки пациента (`check_attempts`, `check_locks`) и отзыв токенов ключа (`access_tokens`) | `store/postgres.ts:176` (allowlist) |
| 71 | `store/postgres.ts:343` | чтение секретных колонок | шифротексты ПДн и секреты партнёров у строк, которые RLS уже вернул | расшифровка в API | нет: колонки закрыты привилегиями | **оставлено**: расшифровывает API, сервисы маскируют | `store/postgres.ts:345` (allowlist) |

## Почему оставшиеся места не переведены

- **Часы** — `services/system/clocks.ts`. Этап 1.5: № 26, 29, 42 убраны из чтения — переходы по дате делает фоновая задача `contract-lifecycle` (каждые 15 минут), подписи ЭДО — опрос оператора на каждом проходе обработчика; списки и карточки только читают (тест `apps/api/src/jobs.test.ts`: чтение ничего не пишет). Цена — состояние может отставать от даты до 15 минут; записи, которым нужен текущий статус (оплата, подпись), вызывают часы своей строки сами. При чтении остались № 3 (сохранение пересчитанного счёта ассистанса — не время, а изменение данных МИГ) и № 16 (ежемесячная выборка) — кандидаты в фоновые задачи на следующем этапе.
- **Последствия** — `services/system/consequences.ts` (№ 36, 41, 59). Это переходы бизнес-процесса МИГ, которые запускает действие другой роли: подпись HR выставляет счета и вводит полис в силу, ответ HR открывает сделку продления, шаг закрывает запросы к другим ролям. Узкая функция здесь означала бы повторить машину состояний договора и тексты событий (`msg`) на SQL. Асинхронная обработка через очередь изменила бы ответ запроса: в нём не оказалось бы созданной сделки или статуса.
- **Исходящие вебхуки** — `services/system/outbox.ts` (№ 28). Подпись тела требует секрета партнёра, а его не читает никто, кроме API.
- **Перенос портфеля** (№ 44–48). Это миграция данных в каждую таблицу, её утверждает второй администратор (четыре глаза).
- **Демо** (№ 1). Маршрут существует только на staging и в CI.
- **Вход, выдача ролей, задачи, партнёрский API, служебный слой** (№ 64, 65, 67–71).
