/* Coverage engine notes (they become part of the AI explanation). */
export const coverage = {
  'coverage.note.unknownCode': 'Услуга {code} не найдена в каталоге',
  'coverage.note.noRule': 'Для «{name}» нет правила в таблице покрытия',
  'coverage.note.excluded': '«{name}» — исключение программы',
  'coverage.note.waiting': 'Период ожидания {days} дн.: покрытие с {from}',
  'coverage.note.limitExhausted': 'Лимит по этому виду помощи исчерпан',
  'coverage.note.subLimit': 'Подлимит {limit}: сверх него не покрывается',
  'coverage.note.partly': 'Остаток лимита {remaining}: покрывается частично',
  'coverage.note.policyInactive': 'Полис не действует на дату услуги',
  'coverage.note.personInactive': 'Застрахованный не покрыт на дату услуги',
  'coverage.note.unrecognized': 'Услуга не распознана',
} satisfies Record<string, string>;
