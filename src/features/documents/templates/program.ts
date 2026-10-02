/*
 * Insurance program (Appendix 1 to the contract): STUB template. The coverage table (AI_COVERAGE_SPEC §3.1)
 * refers to its clauses («п. 3.2 программы»); the real wording and the real exclusions will come from MIG.
 */
import { clause, type DocTemplate } from './types';

export const PROGRAM_TEMPLATE: DocTemplate = {
  id: 'program',
  name: 'Программа страхования',
  version: 'ПРОГРАММА-ЗАГЛУШКА 10/26',
  approved: false,
  heading: 'Программа добровольного медицинского страхования «{{program.name}}»',
  subheading: 'Приложение 1 к договору ДМС',
  signatures: 'none',
  sections: [
    { id: '1', title: '1. Амбулаторно-поликлиническая помощь', clauses: [clause('1.1', 'Приёмы врачей'), clause('1.2', 'Помощь на дому и телемедицина'), clause('1.3', 'Процедуры и манипуляции'), clause('1.4', 'Физиотерапия и массаж', 'Подлимит по программе')] },
    { id: '2', title: '2. Диагностика', clauses: [clause('2.1', 'Лабораторная диагностика'), clause('2.2', 'Инструментальная диагностика'), clause('2.3', 'МРТ и КТ по гарантийному письму')] },
    { id: '3', title: '3. Лекарственное обеспечение', clauses: [clause('3.1', 'Лекарства по назначению врача'), clause('3.2', 'Лекарства без рецепта при остром заболевании'), clause('3.3', 'Вакцинация')] },
    { id: '4', title: '4. Стоматология', clauses: [clause('4.1', 'Лечение зубов'), clause('4.2', 'Гигиена полости рта'), clause('4.3', 'Период ожидания для плановой стоматологии')] },
    { id: '5', title: '5. Стационарная помощь', clauses: [clause('5.1', 'Экстренная и плановая госпитализация по гарантийному письму'), clause('5.2', 'Оперативное лечение'), clause('5.3', 'Ведение беременности и роды'), clause('5.4', 'Скорая помощь')] },
    {
      id: '6',
      title: '6. Исключения (демо-перечень)',
      clauses: [
        clause('6.1', 'Косметология и косметика'),
        clause('6.2', 'БАДы и витамины без назначения врача'),
        clause('6.3', 'Лечебные очки и контактные линзы'),
        clause('6.4', 'Протезирование, имплантация и эстетическая стоматология'),
        clause('6.5', 'Обследования без медицинских показаний'),
      ],
    },
    { id: '7', title: '7. Лимиты и сроки', clauses: [clause('7.1', 'Лимиты по видам помощи'), clause('7.2', 'Период ожидания'), clause('7.3', 'Срок действия покрытия застрахованного')] },
  ],
  fields: [{ key: 'program.name', description: 'Название программы', source: 'Policy.program / Contract.params.program' }],
  tables: [],
};
