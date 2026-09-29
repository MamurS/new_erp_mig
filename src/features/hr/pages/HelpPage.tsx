import { ChevronDown, Mail, Phone } from 'lucide-react';
import { useHrOverview } from '@/shared/api/queries/hr';
import { safeUrl } from '@/shared/lib/safeUrl';
import { useDocumentTitle } from '@/shared/lib/hooks';
import { Avatar } from '@/shared/ui/chips';
import { QueryState, SkeletonRows } from '@/shared/ui/states';
import { HrCard, HrHeader, HrSectionTitle } from '../ui';

const FAQ: { q: string; a: string }[] = [
  {
    q: 'Как добавить нового сотрудника в полис?',
    a: 'На странице «Сотрудники» нажмите «+ Добавить сотрудника» и заполните форму. Если сотрудников много, скачайте шаблон и загрузите их списком через «Загрузить из CSV». После добавления сотрудник получит SMS с приглашением в приложение.',
  },
  {
    q: 'С какой даты сотрудник застрахован?',
    a: 'С даты начала страхования, которую вы указали при добавлении. Если дата уже прошла, полис начинает действовать со следующего рабочего дня после обработки.',
  },
  {
    q: 'Как исключить уволившегося сотрудника?',
    a: 'В списке сотрудников откройте меню в строке сотрудника и выберите «Исключить с даты…». С этой даты полис сотрудника перестанет действовать, а перерасчёт премии появится в следующем счёте.',
  },
  {
    q: 'Почему я не вижу, к каким врачам обращались сотрудники?',
    a: 'Диагнозы, визиты и возмещения — это медицинская тайна. Работодатель видит только, кто застрахован, и общие обезличенные цифры в разделе «Статистика».',
  },
  {
    q: 'Сотрудник не получил приглашение в приложение',
    a: 'Проверьте номер телефона у менеджера МИГ и отправьте приглашение повторно: меню в строке сотрудника → «Пригласить». Чтобы напомнить всем, кто ещё не в приложении, нажмите «Напомнить всем».',
  },
  {
    q: 'Где взять счёт и закрывающие документы?',
    a: 'В разделе «Счета и документы». Если нужного документа нет, напишите менеджеру МИГ.',
  },
];

export default function HelpPage() {
  useDocumentTitle('Помощь');
  const overview = useHrOverview();

  return (
    <>
      <HrHeader title="Помощь" subtitle="Ответы на частые вопросы и контакт вашего менеджера" />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <section aria-labelledby="hr-faq">
          <HrSectionTitle className="mb-3">
            <span id="hr-faq">Частые вопросы</span>
          </HrSectionTitle>
          <div className="flex flex-col gap-3">
            {FAQ.map((f) => (
              <details key={f.q} className="group rounded-card border border-border bg-surface">
                <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 px-5 py-3 font-semibold [&::-webkit-details-marker]:hidden">
                  {f.q}
                  <ChevronDown className="h-5 w-5 shrink-0 text-muted transition-transform group-open:rotate-180 motion-reduce:transition-none" aria-hidden />
                </summary>
                <p className="px-5 pb-4 text-muted">{f.a}</p>
              </details>
            ))}
          </div>
        </section>

        <aside aria-label="Менеджер МИГ">
          <HrCard tone="accent">
            <QueryState query={overview} skeleton={<SkeletonRows rows={3} />}>
              {(o) => (
                <div className="flex flex-col gap-4 text-text">
                  <div className="flex items-center gap-3">
                    <Avatar name={o.manager.name} className="h-12 w-12 bg-surface text-[15px]" />
                    <div>
                      <p className="text-[13px] text-muted">Ваш менеджер в МИГ</p>
                      <p className="font-heading text-[18px] font-semibold">{o.manager.name}</p>
                    </div>
                  </div>
                  <a
                    href={safeUrl(`tel:${o.manager.phone.replace(/[^\d+]/g, '')}`)}
                    className="flex min-h-12 items-center gap-3 rounded-btn bg-surface px-4 font-semibold hover:brightness-95"
                  >
                    <Phone className="h-4 w-4 text-accent" aria-hidden />
                    {o.manager.phone}
                  </a>
                  <a
                    href={safeUrl(`mailto:${o.manager.email}`)}
                    className="flex min-h-12 items-center gap-3 rounded-btn bg-surface px-4 font-semibold hover:brightness-95"
                  >
                    <Mail className="h-4 w-4 text-accent" aria-hidden />
                    {o.manager.email}
                  </a>
                  <p className="text-[13px] text-muted">Пн–Пт, 9:00–18:00 по Ташкенту</p>
                </div>
              )}
            </QueryState>
          </HrCard>
        </aside>
      </div>
    </>
  );
}
