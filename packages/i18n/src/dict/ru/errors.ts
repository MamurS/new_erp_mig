/* Generic API and client errors. Specific server errors live in srv.ts. */
export const errors = {
  'errors.unauthorized': 'Сессия завершена, войдите снова',
  'errors.forbidden': 'Недостаточно прав для этого действия',
  'errors.notFound': 'Не найдено',
  'errors.validation': 'Проверьте заполнение полей',
  'errors.conflict': 'Действие невозможно в текущем состоянии',
  'errors.rateLimited': 'Слишком много попыток. Попробуйте позже',
  'errors.server': 'Сервис временно недоступен. Повторите попытку',
  'errors.internal': 'Внутренняя ошибка сервера',
  'errors.offline': 'Нет соединения с сервером. Проверьте интернет и повторите',
  'errors.badResponse': 'Сервер вернул неожиданный ответ. Повторите позже',
  'errors.badJson': 'Некорректный JSON',
  'errors.tooLarge': 'Слишком большой запрос',
  'errors.csrf': 'Запрос отклонён. Обновите страницу и повторите',
  'errors.unknown': 'Что-то пошло не так. Повторите попытку',
  'errors.docsUnavailable': 'Документация недоступна',
} satisfies Record<string, string>;
