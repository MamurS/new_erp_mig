/* Builds docs/TEMPLATES.md from the template registry, so the list for MIG never drifts from the code. */
import { DOC_TEMPLATES } from './templates';

export function templatesMarkdown(): string {
  const out: string[] = [
    '# Шаблоны документов',
    '',
    'Файл собирается из `src/features/documents/templates/` (тест `src/features/documents/templates.test.ts` сверяет его с кодом; обновить: `UPDATE_TEMPLATES_MD=1 npx vitest run src/features/documents/templates.test.ts`).',
    '',
    'Все шаблоны ниже — **заглушки** (`approved: false`): на каждой странице водяной знак «ШАБЛОН-ЗАГЛУШКА», текст пунктов — «[Текст пункта N будет предоставлен МИГ]». Когда МИГ даст тексты, их вставляют в поле `text` пункта с тем же идентификатором; идентификаторы, поля и таблицы не меняются, потому что на них ссылаются договоры (изменённые пункты), решения по убыткам и таблица покрытия ИИ-проверки. После утверждения шаблону ставится `approved: true`, и его хэш фиксируется тестом, как у брошюры КП.',
    '',
    'Ссылка на пункт в системе: `шаблон:пункт`, например `contract:4.3`.',
    '',
  ];
  for (const t of Object.values(DOC_TEMPLATES)) {
    out.push(`## ${t.name} (\`${t.id}\`)`, '', `Версия: ${t.version} · утверждён: ${t.approved ? 'да' : 'нет (заглушка)'} · подписи: ${t.signatures === 'both' ? 'обе стороны' : t.signatures === 'mig' ? 'МИГ' : 'нет'}`, '');
    out.push(`Заголовок: \`${t.heading}\``, '');
    if (t.subheading) out.push(`Подзаголовок: \`${t.subheading}\``, '');
    out.push('### Разделы и пункты', '', '| Пункт | Заголовок | Строка с данными |', '|---|---|---|');
    for (const s of t.sections) {
      out.push(`| **${s.title}** | | ${s.table ? `таблица \`${s.table}\`` : ''} |`);
      for (const c of s.clauses) out.push(`| \`${t.id}:${c.id}\` | ${c.title} | ${c.data ? `\`${c.data}\`` : '—'} |`);
    }
    out.push('', '### Поля', '', '| Поле | Что это | Откуда берётся |', '|---|---|---|');
    for (const f of t.fields) out.push(`| \`{{${f.key}}}\` | ${f.description} | ${f.source} |`);
    if (t.tables.length) {
      out.push('', '### Таблицы', '', '| Таблица | Столбцы | Откуда берётся |', '|---|---|---|');
      for (const tb of t.tables) out.push(`| \`${tb.id}\` — ${tb.title} | ${tb.columns.join(', ')} | ${tb.source} |`);
    }
    out.push('');
  }
  return out.join('\n');
}
