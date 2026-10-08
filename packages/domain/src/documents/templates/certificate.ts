/* Certificate of an insured person: STUB template, one page. */
import { clause, type DocTemplate } from './types';

export const CERTIFICATE_TEMPLATE: DocTemplate = {
  id: 'certificate',
  name: 'Сертификат застрахованного',
  version: 'СЕРТ-ЗАГЛУШКА 10/26',
  approved: false,
  heading: 'Сертификат застрахованного № {{certificate.number}}',
  subheading: 'к договору добровольного медицинского страхования № {{contract.number}}',
  signatures: 'mig',
  sections: [
    {
      id: '1',
      title: '1. Сведения о страховании',
      clauses: [
        clause('1.1', 'Застрахованное лицо', '{{insured.name}}, {{client.name}}'),
        clause('1.2', 'Полис и программа', 'Полис {{policy.number}}, программа «{{program.name}}»'),
        clause('1.3', 'Срок страхования', 'С {{insured.from}} по {{policy.endDate}}'),
      ],
    },
    {
      id: '2',
      title: '2. Как получить помощь',
      clauses: [clause('2.1', 'Круглосуточная линия', '{{assistance.name}}: {{assistance.phone}}'), clause('2.2', 'Обращение в клинику'), clause('2.3', 'Возмещение расходов')],
    },
    {
      id: '3',
      title: '3. Важно знать',
      clauses: [clause('3.1', 'Исключения и ограничения'), clause('3.2', 'Действительность сертификата')],
    },
  ],
  fields: [
    { key: 'certificate.number', description: 'Номер сертификата', source: 'Insured.certificateNumber' },
    { key: 'contract.number', description: 'Номер договора', source: 'Contract.number' },
    { key: 'insured.name', description: 'ФИО застрахованного', source: 'Insured.fullName' },
    { key: 'insured.from', description: 'Начало покрытия', source: 'Insured.insuredFrom' },
    { key: 'client.name', description: 'Страхователь', source: 'formatLegalName(Client.name, Client.legalForm, язык документа)' },
    { key: 'policy.number', description: 'Номер полиса', source: 'Policy.number' },
    { key: 'policy.endDate', description: 'Окончание срока страхования', source: 'Policy.endDate' },
    { key: 'program.name', description: 'Программа', source: 'Policy.program' },
    { key: 'assistance.name', description: 'Кто обслуживает 24/7', source: 'formatLegalName(AssistanceCompany.name, AssistanceCompany.legalForm, язык документа) или «MIG»' },
    { key: 'assistance.phone', description: 'Телефон 24/7', source: 'AssistanceCompany.phone24x7 или линия МИГ' },
  ],
  tables: [],
};
