/* Empty states with a next step: clinic, assistance and the insured app (DECISIONS «Пустые состояния»). */
export const emptyPartner = {
  // Contact for external roles (they cannot create tasks): the subject only, never personal data.
  'emptyPartner.contact.mig': 'Написать в МИГ',
  'emptyPartner.contact.chat': 'Написать нам',
  'emptyPartner.contact.subject': 'Вопрос по кабинету партнёра',

  // Clinic · Documents
  'emptyPartner.clinic.prices.title': 'Прайс-листа пока нет',
  'emptyPartner.clinic.prices.why': 'Прайс клиники загружает МИГ при подключении клиники к сети ДМС, либо его передаёт ваша МИС через API интеграции.',
  'emptyPartner.clinic.prices.next': 'Отвечает: {role} МИГ. Если клиника уже подключена, а прайса нет — напишите в МИГ.',
  'emptyPartner.clinic.acts.title': 'Актов сверки пока нет',
  'emptyPartner.clinic.acts.why': 'Акт сверки формируется по реестру за месяц после того, как МИГ или ассистанс проверит его и отметит оплату.',
  'emptyPartner.clinic.acts.next': 'Сначала нужно собрать и отправить реестр — это делает {role}.',
  'emptyPartner.clinic.acts.open': 'Перейти к реестрам',

  // Clinic · Registries
  'emptyPartner.clinic.registries.why': 'Реестр за месяц собирается из визитов, открытых после проверки пациента, или загружается из CSV. Пока ни одного реестра не создано.',
  'emptyPartner.clinic.registries.next': 'Выберите период и соберите реестр из визитов или загрузите CSV по шаблону — после отправки его проверит МИГ или ассистанс. Отвечает: {role}.',
  'emptyPartner.clinic.registries.build': 'Собрать реестр из визитов',
  'emptyPartner.clinic.registries.template': 'Скачать шаблон CSV',

  // Clinic · Guarantee letters
  'emptyPartner.clinic.gp.why': 'Гарантийное письмо запрашивается из визита, когда услуга требует согласования. Запросов пока не было.',
  'emptyPartner.clinic.gp.next': 'Проверьте пациента, откройте визит и запросите письмо. Решение принимает ассистанс пациента или МИГ.',
  'emptyPartner.clinic.gp.check': 'Начать с проверки пациента',

  // Integration (clinic and assistance)
  'emptyPartner.keys.why': 'Ключ API нужен для подключения {system} к API МИГ. Пока ни одного ключа не создано.',
  'emptyPartner.keys.next': 'Ключ создаёт {role}; секрет показывается один раз — сразу сохраните его.',
  'emptyPartner.keys.create': 'Создать первый ключ',
  'emptyPartner.webhooks.why': 'Пока адреса нет, МИГ не сообщает вашей системе о событиях — она узнаёт о них только по запросу к API.',
  'emptyPartner.webhooks.next': 'Адрес вебхука добавляет {role}.',
  'emptyPartner.webhooks.create': 'Указать адрес',
  'emptyPartner.webhooks.deliveriesWhy': 'Доставки появятся после первого события, когда добавлен хотя бы один адрес вебхука.',

  // Users (clinic and assistance)
  'emptyPartner.users.title': 'Пользователей пока нет',
  'emptyPartner.users.why': 'Сотрудники входят в кабинет только по приглашению.',
  'emptyPartner.users.next': 'Приглашает {role}: укажите email и роль — ссылка для входа придёт на почту.',
  'emptyPartner.users.invite': 'Пригласить первого сотрудника',

  // Assistance
  'emptyPartner.assist.lines.why': 'Строки счёта берутся из проверенных реестров клиник и сборов по договору с МИГ за период. За этот период их нет.',
  'emptyPartner.assist.lines.next': 'Условия договора с МИГ настраивает {role} МИГ; если строк не хватает — напишите в МИГ.',
  'emptyPartner.assist.cases.why': 'Обращения создаются из звонков и чатов застрахованных ваших клиентов, а также из эскалаций клиник.',
  'emptyPartner.assist.cases.next': 'Чтобы завести обращение из звонка, найдите застрахованного и нажмите «Новое обращение» — это делает {role}.',
  'emptyPartner.assist.cases.find': 'Найти застрахованного',
  'emptyPartner.assist.registries.why': 'Подреестры приходят, когда клиники, обслужившие ваших застрахованных, отправляют реестр за месяц.',
  'emptyPartner.assist.registries.next': 'Реестр отправляет {role}; проверяет его и отмечает оплату {checker}.',
  'emptyPartner.assist.rebills.why': 'Счёт МИГ за месяц формируется из проверенных и оплаченных реестров клиник и сборов по договору.',
  'emptyPartner.assist.rebills.next': 'Счёт формирует и отправляет {role}.',
  'emptyPartner.assist.rebills.build': 'Сформировать первый счёт',
  'emptyPartner.assist.gp.why': 'Гарантийные письма запрашивают клиники из визита пациента или оператор из обращения. Запросов по вашим клиентам пока не было.',
  'emptyPartner.assist.gp.next': 'Решение принимает {role} в пределах полномочий; остальное уходит в МИГ.',

  // Insured app
  'emptyPartner.app.certificate.why': 'Сертификат выпускается вместе с полисом после подписания и оплаты договора вашим работодателем.',
  'emptyPartner.app.certificate.next': 'Отвечает HR вашей компании: уточните у него дату начала страховки.',
  'emptyPartner.app.claims.why': 'Оплатили приём или лекарства сами? Сфотографируйте чек — МИГ вернёт деньги в пределах лимита.',
  'emptyPartner.app.appointments.why': 'Запишитесь в клинику сети ДМС — запись появится здесь, а клиника подтвердит время.',
  'emptyPartner.app.family.why': 'Супруга, детей или родителей добавляют в полис по заявке: отправьте её здесь, HR вашей компании её рассмотрит.',
  'emptyPartner.app.family.request': 'Добавить члена семьи',
  'emptyPartner.app.familyRequests.why': 'Здесь будут ваши заявки на членов семьи и их статус.',
};
