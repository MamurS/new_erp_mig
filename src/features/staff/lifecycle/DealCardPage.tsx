/* Карточка сделки (LIFECYCLE_SPEC §3): stage steps, the panel of the current stage, documents and events. */
import { useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { AlertTriangle, FileText } from 'lucide-react';
import type { DealCard } from '@/shared/types/dto';
import { useCreateContract, useCreateQuote, useDeal, useDealLost, useKpRespond, usePatchDeal, useSendDealKp, useStaffDirectory } from '@/shared/api/queries/lifecycle';
import { errorMessage } from '@/shared/api/client';
import { useCan } from '@/shared/auth/guards';
import { CONTRACT_STATUS_CHIP, CONTRACT_STATUS_LABEL, DEAL_STAGE_LABEL, DEAL_STAGES } from '@/shared/domain/contracts';
import { KP_STATUS_CHIP, KP_STATUS_LABEL } from '@/shared/domain/kp';
import { PROGRAM_LABEL } from '@/shared/domain/labels';
import { dealLostSchema, kpDeclineSchema } from '@/shared/schemas/forms';
import { formatDate, formatDateTime, formatMoney } from '@/shared/lib/format';
import { useDocumentTitle } from '@/shared/lib/hooks';
import { Button } from '@/shared/ui/button';
import { Chip } from '@/shared/ui/chips';
import { Field, Input, Select } from '@/shared/ui/input';
import { Card, Kv, PageHeader } from '@/shared/ui/page';
import { QueryState } from '@/shared/ui/states';
import { toast } from '@/shared/ui/toast';
import { useTopbar } from '../topbar';
import { ReasonDialog, Stepper } from './common';

const QUOTE_STATUS_LABEL = { draft: 'Черновик', pending_approval: 'На согласовании', approved: 'Утверждена', rejected: 'Отклонена' } as const;
const QUOTE_STATUS_CHIP = { draft: 'neutral', pending_approval: 'warning', approved: 'success', rejected: 'danger' } as const;

function useAction() {
  return async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      toast.success(ok);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
}

function StagePanel({ deal }: { deal: DealCard }) {
  const navigate = useNavigate();
  const run = useAction();
  const canManage = useCan('deals.manage');
  const canCensus = useCan('census.upload');
  const canQuote = useCan('quotes.calculate');
  const canKpManual = useCan('kp.respond', { sub: 'manual' });
  const canDraft = useCan('contracts.draft');
  const createQuote = useCreateQuote();
  const sendKp = useSendDealKp();
  const respond = useKpRespond();
  const createContract = useCreateContract();
  const [decline, setDecline] = useState(false);
  const closed = deal.stage === 'lost' || deal.stage === 'active';

  const block = (title: string, text: ReactNode, actions?: ReactNode) => (
    <Card title={`Сейчас: ${title}`}>
      <div className="text-[13px] text-muted">{text}</div>
      {actions && <div className="mt-3 flex flex-wrap gap-2">{actions}</div>}
    </Card>
  );

  if (deal.stage === 'lost') return block('сделка проиграна', `Причина: ${deal.lostReason ?? '—'}`);
  if (deal.stage === 'active')
    return block(
      'договор действует',
      'Полис выпущен, застрахованные получили сертификаты.',
      deal.contract && (
        <Button size="sm" variant="secondary" onClick={() => navigate(`/staff/contracts/${deal.contract!.id}`)}>
          Открыть договор
        </Button>
      ),
    );

  const quoteButton =
    canQuote && !closed ? (
      deal.quote ? (
        <Button size="sm" onClick={() => navigate(`/staff/quotes/${deal.quote!.id}`)}>
          Открыть котировку
        </Button>
      ) : (
        <Button
          size="sm"
          disabled={!deal.census}
          loading={createQuote.isPending}
          onClick={() =>
            void run(async () => {
              const q = await createQuote.mutateAsync({ dealId: deal.id, program: 'standard', adjustments: [] });
              navigate(`/staff/quotes/${q.id}`);
            }, 'Котировка создана')
          }
        >
          Рассчитать котировку
        </Button>
      )
    ) : null;

  switch (deal.stage) {
    case 'lead':
    case 'census':
      return block(
        deal.census ? 'данные для оценки загружены' : 'нужны данные для оценки',
        deal.census
          ? `Загружено ${deal.census.rows.length} человек ${formatDate(deal.census.uploadedAt)}. Следующий шаг — котировка андеррайтера.`
          : 'Попросите у клиента пол, год рождения и тип (сотрудник, супруг, ребёнок) по каждому человеку. Имена и ПИНФЛ на этом этапе не нужны.',
        <>
          {(canCensus || canManage) && (
            <Button size="sm" variant={deal.census ? 'secondary' : 'primary'} onClick={() => navigate(`/staff/deals/${deal.id}/census`)}>
              {deal.census ? 'Данные для оценки' : 'Загрузить данные для оценки'}
            </Button>
          )}
          {quoteButton}
        </>,
      );
    case 'quote': {
      const q = deal.quote;
      const approved = q?.status === 'approved';
      return block(
        q ? `котировка — ${QUOTE_STATUS_LABEL[q.status].toLowerCase()}` : 'котировка',
        approved ? 'Котировка утверждена. КП отправляется только по утверждённой котировке, его параметры берутся из неё.' : 'КП можно отправить только по утверждённой котировке.',
        <>
          {quoteButton}
          {!canQuote && q && (
            <Button size="sm" variant="secondary" onClick={() => navigate(`/staff/quotes/${q.id}`)}>
              Котировка
            </Button>
          )}
          {canManage && (
            <Button size="sm" disabled={!approved} loading={sendKp.isPending} onClick={() => void run(() => sendKp.mutateAsync(deal.id), 'КП отправлено клиенту')}>
              Отправить КП
            </Button>
          )}
        </>,
      );
    }
    case 'kp_sent':
      return (
        <>
          {block(
            'КП у клиента',
            'Клиент принимает или отклоняет КП в кабинете HR. Если клиент ответил письмом, отметьте решение вручную.',
            <>
              {deal.kp && (
                <Button size="sm" variant="secondary" onClick={() => navigate(`/staff/kp/${deal.kp!.id}`)}>
                  Открыть КП
                </Button>
              )}
              {canKpManual && deal.kp && (
                <>
                  <Button size="sm" loading={respond.isPending} onClick={() => void run(() => respond.mutateAsync({ kpId: deal.kp!.id, decision: 'accept' }), 'Отмечено: клиент принял КП')}>
                    Клиент принял
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => setDecline(true)}>
                    Клиент отклонил
                  </Button>
                </>
              )}
            </>,
          )}
          {deal.kp && (
            <ReasonDialog
              open={decline}
              onClose={() => setDecline(false)}
              title="Клиент отклонил КП"
              description="Сделка останется на этапе КП: можно пересчитать котировку или отметить сделку проигранной."
              label="Причина отказа"
              field="reason"
              schema={kpDeclineSchema}
              confirmLabel="Отметить отказ"
              danger
              onSubmit={(reason) => respond.mutateAsync({ kpId: deal.kp!.id, decision: 'decline', reason })}
            />
          )}
        </>
      );
    case 'kp_accepted':
      return block(
        'КП принято',
        'Подготовьте договор: параметры возьмутся из утверждённой котировки и реквизитов клиента.',
        canDraft && (
          <Button
            size="sm"
            loading={createContract.isPending}
            onClick={() =>
              void run(async () => {
                const c = await createContract.mutateAsync(deal.id);
                navigate(`/staff/contracts/${c.id}`);
              }, 'Договор создан')
            }
          >
            Подготовить договор
          </Button>
        ),
      );
    default:
      return block(
        DEAL_STAGE_LABEL[deal.stage].toLowerCase(),
        deal.stage === 'awaiting_payment' ? 'Договор подписан. Полис выпускается по правилу вступления в силу: обычно после первой оплаты.' : 'Работа идёт в карточке договора.',
        deal.contract && (
          <Button size="sm" onClick={() => navigate(`/staff/contracts/${deal.contract!.id}`)}>
            Открыть договор
          </Button>
        ),
      );
  }
}

function DealInfo({ deal }: { deal: DealCard }) {
  const canManage = useCan('deals.manage');
  const patch = usePatchDeal();
  const directory = useStaffDirectory();
  const underwriters = (directory.data ?? []).filter((s) => s.role === 'underwriter');
  const [start, setStart] = useState(deal.expectedStart ? formatDate(deal.expectedStart) : '');
  const closed = deal.stage === 'lost' || deal.stage === 'active';
  const save = async (body: { expectedStart?: string; underwriterId?: string }) => {
    try {
      await patch.mutateAsync({ id: deal.id, ...body });
      toast.success('Сохранено');
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  return (
    <Card title="Сделка">
      <dl className="text-[13px]">
        <Kv label="Клиент">
          <Link className="text-accent-text underline-offset-2 hover:underline" to={`/staff/clients/${deal.clientId}`}>
            {deal.clientName}
          </Link>
        </Kv>
        <Kv label="Тип">{deal.type === 'renewal' ? 'Продление' : 'Новый клиент'}</Kv>
        <Kv label="Менеджер">{deal.ownerName}</Kv>
        <Kv label="Численность, примерно">{deal.client.estimatedHeadcount ?? '—'}</Kv>
        <Kv label="Текущий страховщик">{deal.client.currentInsurer ?? '—'}</Kv>
        <Kv label="Премия">{deal.premium ? <span className="num">{formatMoney(deal.premium)}</span> : '—'}</Kv>
      </dl>
      {canManage && !closed ? (
        <div className="mt-3 grid gap-3 border-t border-border-soft pt-3">
          <Field label="Андеррайтер">
            {(a) => (
              <Select {...a} value={deal.underwriterId ?? ''} onChange={(e) => e.target.value && void save({ underwriterId: e.target.value })}>
                <option value="">Не назначен</option>
                {underwriters.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.fullName}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Желаемое начало">
            {(a) => (
              <div className="flex gap-2">
                <Input {...a} value={start} maxLength={10} placeholder="ДД.ММ.ГГГГ" onChange={(e) => setStart(e.target.value)} />
                <Button size="sm" variant="secondary" disabled={!start} onClick={() => void save({ expectedStart: start })}>
                  Сохранить
                </Button>
              </div>
            )}
          </Field>
        </div>
      ) : (
        <dl className="text-[13px]">
          <Kv label="Андеррайтер">{deal.underwriterName ?? '—'}</Kv>
          <Kv label="Желаемое начало">{deal.expectedStart ? formatDate(deal.expectedStart) : '—'}</Kv>
        </dl>
      )}
    </Card>
  );
}

function Documents({ deal }: { deal: DealCard }) {
  const rows: { label: string; to?: string; chip?: ReactNode; meta?: string }[] = [];
  if (deal.census) rows.push({ label: `Данные для оценки: ${deal.census.rows.length} человек`, to: `/staff/deals/${deal.id}/census`, meta: formatDate(deal.census.uploadedAt) });
  if (deal.quote)
    rows.push({
      label: `Котировка: ${PROGRAM_LABEL[deal.quote.program]}, ${formatMoney(deal.quote.total)}`,
      to: `/staff/quotes/${deal.quote.id}`,
      chip: <Chip kind={QUOTE_STATUS_CHIP[deal.quote.status]}>{QUOTE_STATUS_LABEL[deal.quote.status]}</Chip>,
    });
  if (deal.kp) rows.push({ label: `КП ${deal.kp.number}`, to: `/staff/kp/${deal.kp.id}`, chip: <Chip kind={KP_STATUS_CHIP[deal.kp.status]}>{KP_STATUS_LABEL[deal.kp.status]}</Chip> });
  if (deal.contract)
    rows.push({
      label: `Договор ${deal.contract.number}, версия ${deal.contract.version}`,
      to: `/staff/contracts/${deal.contract.id}`,
      chip: <Chip kind={CONTRACT_STATUS_CHIP[deal.contract.status]}>{CONTRACT_STATUS_LABEL[deal.contract.status]}</Chip>,
    });
  return (
    <Card title="Документы сделки" bodyClassName="p-0">
      {rows.length ? (
        <ul className="divide-y divide-border-soft text-[13px]">
          {rows.map((r) => (
            <li key={r.label} className="flex items-center justify-between gap-2 px-4 py-2.5">
              <span className="flex min-w-0 items-center gap-2">
                <FileText className="h-4 w-4 shrink-0 text-muted" aria-hidden />
                {r.to ? (
                  <Link to={r.to} className="truncate text-accent-text hover:underline">
                    {r.label}
                  </Link>
                ) : (
                  <span className="truncate">{r.label}</span>
                )}
              </span>
              {r.chip ?? (r.meta && <span className="num text-muted">{r.meta}</span>)}
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-4 py-3 text-[13px] text-muted">Документов пока нет</p>
      )}
    </Card>
  );
}

export default function DealCardPage() {
  const { dealId = '' } = useParams();
  const q = useDeal(dealId);
  const lost = useDealLost();
  const canManage = useCan('deals.manage');
  const [lostOpen, setLostOpen] = useState(false);
  useDocumentTitle(q.data ? `Сделка ${q.data.number}` : 'Сделка');
  useTopbar([{ label: 'Сделки', to: '/staff/deals' }, { label: q.data?.number ?? 'Сделка' }]);

  return (
    <QueryState query={q}>
      {(deal) => (
        <>
          <PageHeader
            title={
              <span className="flex flex-wrap items-center gap-2">
                {deal.clientName}
                {deal.type === 'renewal' && <Chip kind="renewal">продление</Chip>}
              </span>
            }
            subtitle={<span className="num">Сделка {deal.number} · создана {formatDate(deal.createdAt)}</span>}
            actions={
              canManage &&
              deal.stage !== 'lost' &&
              deal.stage !== 'active' && (
                <Button variant="secondary" onClick={() => setLostOpen(true)}>
                  Сделка проиграна
                </Button>
              )
            }
          />
          <div className="mb-4 rounded-card border border-border bg-surface p-3">
            <Stepper steps={deal.stage === 'lost' ? [...DEAL_STAGES, 'lost' as const] : DEAL_STAGES} current={deal.stage} labels={DEAL_STAGE_LABEL} failed={deal.stage === 'lost'} />
          </div>
          {deal.reminders.map((r) => (
            <p key={r} role="status" className="mb-3 flex items-center gap-2 rounded-card border border-warning/40 bg-warning-soft px-3 py-2 text-[13px] text-warning-text">
              <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
              {r}
            </p>
          ))}
          <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
            <div className="flex min-w-0 flex-col gap-4">
              <StagePanel deal={deal} />
              <Documents deal={deal} />
              <Card title="События" bodyClassName="p-0">
                <ol className="divide-y divide-border-soft text-[13px]" data-testid="deal-events">
                  {[...deal.events].reverse().map((e) => (
                    <li key={e.id} className="px-4 py-2.5">
                      <p>{e.text}</p>
                      <p className="mt-0.5 text-[12px] text-muted">
                        <span className="num">{formatDateTime(e.at)}</span> · {e.actorName}
                      </p>
                    </li>
                  ))}
                </ol>
              </Card>
            </div>
            <DealInfo deal={deal} />
          </div>
          <ReasonDialog
            open={lostOpen}
            onClose={() => setLostOpen(false)}
            title="Сделка проиграна"
            description="Сделка закроется на текущем этапе. Причина попадёт в ленту событий и в журнал аудита."
            label="Причина"
            field="reason"
            schema={dealLostSchema}
            confirmLabel="Закрыть сделку"
            danger
            onSubmit={(reason) => lost.mutateAsync({ id: deal.id, reason })}
          />
        </>
      )}
    </QueryState>
  );
}
