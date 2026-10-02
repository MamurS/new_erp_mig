/* Letter to the insured person about the decision on a claim: STUB template. */
import { clause, type DocTemplate } from './types';

export const CLAIM_DECISION_LETTER_TEMPLATE: DocTemplate = {
  id: 'claimDecisionLetter',
  name: 'Письмо о решении по убытку',
  version: 'ПИСЬМО-ЗАГЛУШКА 10/26',
  approved: false,
  heading: 'Решение по обращению № {{claim.number}}',
  subheading: 'г. Ташкент · {{decision.date}} · {{insured.name}}',
  signatures: 'mig',
  sections: [
    {
      id: '1',
      title: '1. Решение',
      clauses: [
        clause('1.1', 'Результат рассмотрения', '{{decision.kind}}. Заявлено {{claim.amountClaimed}}, к выплате {{decision.amount}}'),
        clause('1.2', 'Срок выплаты'),
      ],
    },
    {
      id: '2',
      title: '2. Основание',
      clauses: [clause('2.1', 'Пункт договора и правил', '{{decision.clause}}'), clause('2.2', 'Пояснение', '{{decision.reason}}')],
    },
    {
      id: '3',
      title: '3. Если вы не согласны',
      clauses: [clause('3.1', 'Порядок оспаривания'), clause('3.2', 'Срок подачи возражения')],
    },
  ],
  fields: [
    { key: 'claim.number', description: 'Номер убытка', source: 'Claim.number' },
    { key: 'claim.amountClaimed', description: 'Заявленная сумма', source: 'Claim.amountClaimed' },
    { key: 'insured.name', description: 'Адресат', source: 'Claim.insuredName' },
    { key: 'decision.date', description: 'Дата решения', source: 'Claim.decision.at' },
    { key: 'decision.kind', description: 'Одобрено полностью, частично или отказано', source: 'Claim.decision.kind' },
    { key: 'decision.amount', description: 'Сумма к выплате', source: 'Claim.decision.amount' },
    { key: 'decision.clause', description: 'Пункт, на основании которого принято решение', source: 'Claim.decision.clauseId → каталог пунктов шаблонов' },
    { key: 'decision.reason', description: 'Причина простым языком', source: 'Claim.decision.reason' },
    { key: 'mig.name', description: 'Отправитель', source: 'Реквизиты МИГ' },
  ],
  tables: [],
};
