# Шаблоны документов

Файл собирается из `src/features/documents/templates/` (тест `src/features/documents/templates.test.ts` сверяет его с кодом; обновить: `UPDATE_TEMPLATES_MD=1 npx vitest run src/features/documents/templates.test.ts`).

Все шаблоны ниже — **заглушки** (`approved: false`): на каждой странице водяной знак «ШАБЛОН-ЗАГЛУШКА», текст пунктов — «[Текст пункта N будет предоставлен МИГ]». Когда МИГ даст тексты, их вставляют в поле `text` пункта с тем же идентификатором; идентификаторы, поля и таблицы не меняются, потому что на них ссылаются договоры (изменённые пункты), решения по убыткам и таблица покрытия ИИ-проверки. После утверждения шаблону ставится `approved: true`, и его хэш фиксируется тестом, как у брошюры КП.

Ссылка на пункт в системе: `шаблон:пункт`, например `contract:4.3`.

## Договор ДМС (`contract`)

Версия: ДОГОВОР-ЗАГЛУШКА 10/26 · утверждён: нет (заглушка) · подписи: обе стороны

Заголовок: `Договор добровольного медицинского страхования № {{contract.number}}`

Подзаголовок: `г. Ташкент · {{contract.date}} · редакция {{contract.version}}`

### Разделы и пункты

| Пункт | Заголовок | Строка с данными |
|---|---|---|
| **1. Стороны и предмет договора** | |  |
| `contract:1.1` | Стороны договора | `{{mig.name}} (Страховщик), в лице {{mig.signatory.position}} {{mig.signatory.name}}, действующего на основании {{mig.signatory.basis}}, и {{client.name}} (Страхователь), в лице {{client.signatory.position}} {{client.signatory.name}}, действующего на основании {{client.signatory.basis}}` |
| `contract:1.2` | Предмет договора | `Программа страхования: {{program.name}} (Приложение 1)` |
| `contract:1.3` | Правила страхования | `Правила страхования: {{contract.rulesRef}}` |
| **2. Термины и определения** | |  |
| `contract:2.1` | Основные термины | — |
| `contract:2.2` | Толкование терминов | — |
| **3. Застрахованные лица** | |  |
| `contract:3.1` | Список застрахованных | `Застрахованных: {{insured.total}}, из них сотрудников {{insured.employees}}, членов семей {{insured.family}} (Приложение 2)` |
| `contract:3.2` | Сертификаты застрахованных | — |
| `contract:3.3` | Включение и исключение застрахованных | — |
| **4. Страховые случаи и исключения** | |  |
| `contract:4.1` | Страховой случай | — |
| `contract:4.2` | Объём медицинской помощи | — |
| `contract:4.3` | Исключения из страхового покрытия | — |
| `contract:4.4` | Период ожидания | — |
| `contract:4.5` | Услуги по гарантийному письму | — |
| `contract:4.6` | Лимиты и подлимиты | — |
| **5. Страховая премия и порядок оплаты** | |  |
| `contract:5.1` | Размер страховой премии | `Премия за сотрудника {{premium.employee}}, за члена семьи {{premium.family}}, общая премия {{premium.total}}` |
| `contract:5.2` | График платежей | `Порядок оплаты: {{contract.paymentFrequency}} (Приложение 3)` |
| `contract:5.3` | Просрочка оплаты | — |
| **6. Срок действия договора** | |  |
| `contract:6.1` | Срок страхования | `С {{contract.startDate}} по {{contract.endDate}}` |
| `contract:6.2` | Вступление договора в силу | `Порядок вступления в силу: {{contract.activationRule}}` |
| `contract:6.3` | Продление договора | — |
| **7. Права и обязанности сторон** | |  |
| `contract:7.1` | Обязанности Страховщика | — |
| `contract:7.2` | Обязанности Страхователя | — |
| `contract:7.3` | Права Страховщика | — |
| `contract:7.4` | Права Страхователя | — |
| **8. Урегулирование страховых случаев** | |  |
| `contract:8.1` | Порядок обращения за помощью | — |
| `contract:8.2` | Документы для возмещения | — |
| `contract:8.3` | Сроки рассмотрения | — |
| `contract:8.4` | Основания для отказа в выплате | — |
| `contract:8.5` | Частичное возмещение | — |
| `contract:8.6` | Оспаривание решения | — |
| **9. Изменение и расторжение договора** | |  |
| `contract:9.1` | Дополнительные соглашения | — |
| `contract:9.2` | Досрочное расторжение | — |
| `contract:9.3` | Возврат части премии | — |
| **10. Конфиденциальность и персональные данные** | |  |
| `contract:10.1` | Обработка персональных данных | — |
| `contract:10.2` | Медицинская тайна | — |
| **11. Разрешение споров и прочие условия** | |  |
| `contract:11.1` | Порядок разрешения споров | — |
| `contract:11.2` | Количество экземпляров | — |
| **12. Реквизиты сторон** | |  |
| `contract:12.1` | Страховщик | `{{mig.name}}, ИНН {{mig.inn}}, {{mig.address}}, р/с {{mig.account}} в {{mig.bank}}, МФО {{mig.mfo}}` |
| `contract:12.2` | Страхователь | `{{client.name}}, ИНН {{client.inn}}, {{client.address}}, р/с {{client.account}} в {{client.bank}}, МФО {{client.mfo}}` |
| **Приложение 1. Программа страхования «{{program.name}}»** | | таблица `program` |
| `contract:П1.1` | Состав программы | — |
| **Приложение 2. Список застрахованных** | | таблица `insured` |
| `contract:П2.1` | Порядок ведения списка | — |
| **Приложение 3. График платежей** | | таблица `schedule` |
| `contract:П3.1` | Порядок оплаты взносов | — |

### Поля

| Поле | Что это | Откуда берётся |
|---|---|---|
| `{{contract.number}}` | Номер договора | Contract.number |
| `{{contract.date}}` | Дата договора | Contract.createdAt (дата создания версии) |
| `{{contract.version}}` | Номер редакции | Contract.version |
| `{{contract.startDate}}` | Начало срока страхования | Contract.params.startDate |
| `{{contract.endDate}}` | Окончание срока страхования | Contract.params.endDate |
| `{{contract.activationRule}}` | Порядок вступления в силу | Contract.params.activationRule: с даты начала или после первого взноса |
| `{{contract.paymentFrequency}}` | Порядок оплаты | Contract.params.paymentFrequency: единовременно, поквартально, помесячно |
| `{{contract.rulesRef}}` | Ссылка на правила страхования | Константа MIG_RULES_REF (документы МИГ) |
| `{{mig.name}}` | Наименование страховщика | Реквизиты МИГ (src/features/documents/mig.ts) |
| `{{mig.inn}}` | ИНН страховщика | Реквизиты МИГ |
| `{{mig.address}}` | Адрес страховщика | Реквизиты МИГ |
| `{{mig.bank}}` | Банк страховщика | Реквизиты МИГ |
| `{{mig.account}}` | Расчётный счёт страховщика | Реквизиты МИГ |
| `{{mig.mfo}}` | МФО банка страховщика | Реквизиты МИГ |
| `{{mig.signatory.name}}` | Подписант МИГ | Contract.params.migSignatoryId → StaffUser.fullName |
| `{{mig.signatory.position}}` | Должность подписанта МИГ | Роль подписанта (StaffUser.role) |
| `{{mig.signatory.basis}}` | Основание полномочий подписанта МИГ | StaffUser.signatory.basis |
| `{{client.name}}` | Наименование страхователя | Карточка клиента: formatLegalName(Client.name, Client.legalForm, язык документа) |
| `{{client.inn}}` | ИНН страхователя | Client.inn |
| `{{client.address}}` | Адрес страхователя | Client.requisites.address |
| `{{client.bank}}` | Банк страхователя | Client.requisites.bank |
| `{{client.account}}` | Расчётный счёт страхователя | Client.requisites.account |
| `{{client.mfo}}` | МФО банка страхователя | Client.requisites.mfo |
| `{{client.signatory.name}}` | Подписант клиента | Contract.params.clientSignatory.name (по умолчанию Client.requisites.director) |
| `{{client.signatory.position}}` | Должность подписанта клиента | Contract.params.clientSignatory.position |
| `{{client.signatory.basis}}` | Основание полномочий подписанта клиента | Contract.params.clientSignatory.basis (по умолчанию Client.requisites.directorBasis) |
| `{{program.name}}` | Программа страхования | Contract.params.program (из утверждённой котировки) |
| `{{premium.employee}}` | Премия за сотрудника в год | Contract.params.premiumEmployee |
| `{{premium.family}}` | Премия за члена семьи в год | Contract.params.premiumFamily |
| `{{premium.total}}` | Общая премия | Contract.params.total |
| `{{insured.employees}}` | Число сотрудников | Contract.params.employees |
| `{{insured.family}}` | Число членов семей | Contract.params.familyMembers |
| `{{insured.total}}` | Всего застрахованных | employees + familyMembers |

### Таблицы

| Таблица | Столбцы | Откуда берётся |
|---|---|---|
| `program` — Лимиты программы | Категория, Лимит на застрахованного | PROGRAMS[Contract.params.program].limits |
| `insured` — Список застрахованных | №, ФИО, Должность, Кем приходится | Список приложения 2: строка на каждого застрахованного с отношением к сотруднику, без ПИНФЛ и телефонов |
| `schedule` — График платежей | №, Срок оплаты, Сумма | Contract.params.paymentSchedule |

## Дополнительное соглашение (`endorsement`)

Версия: ДС-ЗАГЛУШКА 10/26 · утверждён: нет (заглушка) · подписи: обе стороны

Заголовок: `Дополнительное соглашение {{endorsement.number}}`

Подзаголовок: `к договору добровольного медицинского страхования № {{contract.number}} · г. Ташкент · {{endorsement.date}}`

### Разделы и пункты

| Пункт | Заголовок | Строка с данными |
|---|---|---|
| **1. Предмет соглашения** | |  |
| `endorsement:1.1` | Стороны и предмет | `{{mig.name}} и {{client.name}} договорились внести изменения в договор № {{contract.number}}` |
| `endorsement:1.2` | Вид изменений | `{{endorsement.kind}}` |
| **2. Изменения условий** | | таблица `lines` |
| `endorsement:2.1` | Перечень изменений | — |
| `endorsement:2.2` | Дата вступления изменений в силу | `{{endorsement.effective}}` |
| **3. Расчёт премии** | |  |
| `endorsement:3.1` | Порядок расчёта | `Итого: {{endorsement.totalLabel}} {{endorsement.total}}` |
| `endorsement:3.2` | Порядок оплаты или возврата | — |
| **4. Заключительные положения** | |  |
| `endorsement:4.1` | Неизменность прочих условий | — |
| `endorsement:4.2` | Вступление соглашения в силу | — |

### Поля

| Поле | Что это | Откуда берётся |
|---|---|---|
| `{{endorsement.number}}` | Номер соглашения | Endorsement.number |
| `{{endorsement.date}}` | Дата соглашения | Endorsement.createdAt |
| `{{endorsement.kind}}` | Вид: изменения состава и условий или расторжение | Endorsement.kind |
| `{{endorsement.effective}}` | Даты вступления изменений в силу | ChangeRequest.effectiveDate по строкам или Endorsement.terminationDate |
| `{{endorsement.total}}` | Сумма доплаты или возврата | Endorsement.total (по модулю) |
| `{{endorsement.totalLabel}}` | «к доплате» или «к возврату» | Знак Endorsement.total |
| `{{contract.number}}` | Номер договора | Contract.number |
| `{{mig.name}}` | Наименование страховщика | Реквизиты МИГ |
| `{{mig.signatory.name}}` | Подписант МИГ | Подписант договора |
| `{{client.name}}` | Наименование страхователя | formatLegalName(Client.name, Client.legalForm, язык документа) |
| `{{client.signatory.name}}` | Подписант клиента | Contract.params.clientSignatory.name |

### Таблицы

| Таблица | Столбцы | Откуда берётся |
|---|---|---|
| `lines` — Расчёт по строкам | №, Изменение, Дней, Формула, Сумма | Endorsement.lines: description, days, formula, amount |

## Сертификат застрахованного (`certificate`)

Версия: СЕРТ-ЗАГЛУШКА 10/26 · утверждён: нет (заглушка) · подписи: МИГ

Заголовок: `Сертификат застрахованного № {{certificate.number}}`

Подзаголовок: `к договору добровольного медицинского страхования № {{contract.number}}`

### Разделы и пункты

| Пункт | Заголовок | Строка с данными |
|---|---|---|
| **1. Сведения о страховании** | |  |
| `certificate:1.1` | Застрахованное лицо | `{{insured.name}}, {{client.name}}` |
| `certificate:1.2` | Полис и программа | `Полис {{policy.number}}, программа «{{program.name}}»` |
| `certificate:1.3` | Срок страхования | `С {{insured.from}} по {{policy.endDate}}` |
| **2. Как получить помощь** | |  |
| `certificate:2.1` | Круглосуточная линия | `{{assistance.name}}: {{assistance.phone}}` |
| `certificate:2.2` | Обращение в клинику | — |
| `certificate:2.3` | Возмещение расходов | — |
| **3. Важно знать** | |  |
| `certificate:3.1` | Исключения и ограничения | — |
| `certificate:3.2` | Действительность сертификата | — |

### Поля

| Поле | Что это | Откуда берётся |
|---|---|---|
| `{{certificate.number}}` | Номер сертификата | Insured.certificateNumber |
| `{{contract.number}}` | Номер договора | Contract.number |
| `{{insured.name}}` | ФИО застрахованного | Insured.fullName |
| `{{insured.from}}` | Начало покрытия | Insured.insuredFrom |
| `{{client.name}}` | Страхователь | formatLegalName(Client.name, Client.legalForm, язык документа) |
| `{{policy.number}}` | Номер полиса | Policy.number |
| `{{policy.endDate}}` | Окончание срока страхования | Policy.endDate |
| `{{program.name}}` | Программа | Policy.program |
| `{{assistance.name}}` | Кто обслуживает 24/7 | formatLegalName(AssistanceCompany.name, AssistanceCompany.legalForm, язык документа) или «MIG» |
| `{{assistance.phone}}` | Телефон 24/7 | AssistanceCompany.phone24x7 или линия МИГ |

## Письмо о решении по убытку (`claimDecisionLetter`)

Версия: ПИСЬМО-ЗАГЛУШКА 10/26 · утверждён: нет (заглушка) · подписи: МИГ

Заголовок: `Решение по обращению № {{claim.number}}`

Подзаголовок: `г. Ташкент · {{decision.date}} · {{insured.name}}`

### Разделы и пункты

| Пункт | Заголовок | Строка с данными |
|---|---|---|
| **1. Решение** | |  |
| `claimDecisionLetter:1.1` | Результат рассмотрения | `{{decision.kind}}. Заявлено {{claim.amountClaimed}}, к выплате {{decision.amount}}` |
| `claimDecisionLetter:1.2` | Срок выплаты | — |
| **2. Основание** | |  |
| `claimDecisionLetter:2.1` | Пункт договора и правил | `{{decision.clause}}` |
| `claimDecisionLetter:2.2` | Пояснение | `{{decision.reason}}` |
| **3. Если вы не согласны** | |  |
| `claimDecisionLetter:3.1` | Порядок оспаривания | — |
| `claimDecisionLetter:3.2` | Срок подачи возражения | — |

### Поля

| Поле | Что это | Откуда берётся |
|---|---|---|
| `{{claim.number}}` | Номер убытка | Claim.number |
| `{{claim.amountClaimed}}` | Заявленная сумма | Claim.amountClaimed |
| `{{insured.name}}` | Адресат | Claim.insuredName |
| `{{decision.date}}` | Дата решения | Claim.decision.at |
| `{{decision.kind}}` | Одобрено полностью, частично или отказано | Claim.decision.kind |
| `{{decision.amount}}` | Сумма к выплате | Claim.decision.amount |
| `{{decision.clause}}` | Пункт, на основании которого принято решение | Claim.decision.clauseId → каталог пунктов шаблонов |
| `{{decision.reason}}` | Причина простым языком | Claim.decision.reason |
| `{{mig.name}}` | Отправитель | Реквизиты МИГ |

## Программа страхования (`program`)

Версия: ПРОГРАММА-ЗАГЛУШКА 10/26 · утверждён: нет (заглушка) · подписи: нет

Заголовок: `Программа добровольного медицинского страхования «{{program.name}}»`

Подзаголовок: `Приложение 1 к договору ДМС`

### Разделы и пункты

| Пункт | Заголовок | Строка с данными |
|---|---|---|
| **1. Амбулаторно-поликлиническая помощь** | |  |
| `program:1.1` | Приёмы врачей | — |
| `program:1.2` | Помощь на дому и телемедицина | — |
| `program:1.3` | Процедуры и манипуляции | — |
| `program:1.4` | Физиотерапия и массаж | `Подлимит по программе` |
| **2. Диагностика** | |  |
| `program:2.1` | Лабораторная диагностика | — |
| `program:2.2` | Инструментальная диагностика | — |
| `program:2.3` | МРТ и КТ по гарантийному письму | — |
| **3. Лекарственное обеспечение** | |  |
| `program:3.1` | Лекарства по назначению врача | — |
| `program:3.2` | Лекарства без рецепта при остром заболевании | — |
| `program:3.3` | Вакцинация | — |
| **4. Стоматология** | |  |
| `program:4.1` | Лечение зубов | — |
| `program:4.2` | Гигиена полости рта | — |
| `program:4.3` | Период ожидания для плановой стоматологии | — |
| **5. Стационарная помощь** | |  |
| `program:5.1` | Экстренная и плановая госпитализация по гарантийному письму | — |
| `program:5.2` | Оперативное лечение | — |
| `program:5.3` | Ведение беременности и роды | — |
| `program:5.4` | Скорая помощь | — |
| **6. Исключения (демо-перечень)** | |  |
| `program:6.1` | Косметология и косметика | — |
| `program:6.2` | БАДы и витамины без назначения врача | — |
| `program:6.3` | Лечебные очки и контактные линзы | — |
| `program:6.4` | Протезирование, имплантация и эстетическая стоматология | — |
| `program:6.5` | Обследования без медицинских показаний | — |
| **7. Лимиты и сроки** | |  |
| `program:7.1` | Лимиты по видам помощи | — |
| `program:7.2` | Период ожидания | — |
| `program:7.3` | Срок действия покрытия застрахованного | — |

### Поля

| Поле | Что это | Откуда берётся |
|---|---|---|
| `{{program.name}}` | Название программы | Policy.program / Contract.params.program |
