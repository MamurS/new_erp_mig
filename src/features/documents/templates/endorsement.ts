/* Supplementary agreement (дополнительное соглашение) to a DMS contract: STUB template. */
import { clause, type DocTemplate } from './types';

export const ENDORSEMENT_TEMPLATE: DocTemplate = {
  id: 'endorsement',
  name: 'Дополнительное соглашение',
  version: 'ДС-ЗАГЛУШКА 10/26',
  approved: false,
  heading: 'Дополнительное соглашение {{endorsement.number}}',
  subheading: 'к договору добровольного медицинского страхования № {{contract.number}} · г. Ташкент · {{endorsement.date}}',
  signatures: 'both',
  sections: [
    {
      id: '1',
      title: '1. Предмет соглашения',
      clauses: [clause('1.1', 'Стороны и предмет', '{{mig.name}} и {{client.name}} договорились внести изменения в договор № {{contract.number}}'), clause('1.2', 'Вид изменений', '{{endorsement.kind}}')],
    },
    {
      id: '2',
      title: '2. Изменения условий',
      clauses: [clause('2.1', 'Перечень изменений'), clause('2.2', 'Дата вступления изменений в силу', '{{endorsement.effective}}')],
      table: 'lines',
    },
    {
      id: '3',
      title: '3. Расчёт премии',
      clauses: [clause('3.1', 'Порядок расчёта', 'Итого: {{endorsement.totalLabel}} {{endorsement.total}}'), clause('3.2', 'Порядок оплаты или возврата')],
    },
    {
      id: '4',
      title: '4. Заключительные положения',
      clauses: [clause('4.1', 'Неизменность прочих условий'), clause('4.2', 'Вступление соглашения в силу')],
    },
  ],
  fields: [
    { key: 'endorsement.number', description: 'Номер соглашения', source: 'Endorsement.number' },
    { key: 'endorsement.date', description: 'Дата соглашения', source: 'Endorsement.createdAt' },
    { key: 'endorsement.kind', description: 'Вид: изменения состава и условий или расторжение', source: 'Endorsement.kind' },
    { key: 'endorsement.effective', description: 'Даты вступления изменений в силу', source: 'ChangeRequest.effectiveDate по строкам или Endorsement.terminationDate' },
    { key: 'endorsement.total', description: 'Сумма доплаты или возврата', source: 'Endorsement.total (по модулю)' },
    { key: 'endorsement.totalLabel', description: '«к доплате» или «к возврату»', source: 'Знак Endorsement.total' },
    { key: 'contract.number', description: 'Номер договора', source: 'Contract.number' },
    { key: 'mig.name', description: 'Наименование страховщика', source: 'Реквизиты МИГ' },
    { key: 'mig.signatory.name', description: 'Подписант МИГ', source: 'Подписант договора' },
    { key: 'client.name', description: 'Наименование страхователя', source: 'Client.legalForm + Client.name' },
    { key: 'client.signatory.name', description: 'Подписант клиента', source: 'Contract.params.clientSignatory.name' },
  ],
  tables: [
    {
      id: 'lines',
      title: 'Расчёт по строкам',
      columns: ['№', 'Изменение', 'Дней', 'Формула', 'Сумма'],
      source: 'Endorsement.lines: description, days, formula, amount',
    },
  ],
};
