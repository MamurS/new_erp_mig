import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AlertTriangle, FileImage, ZoomIn, ZoomOut } from 'lucide-react';
import type { Attachment, ClaimStatus } from '@/shared/types';
import type { ClaimDetail } from '@/shared/types/dto';
import { useClaim, useTransition } from '@/shared/api/queries/staff';
import { useFileUrl } from '@/shared/api/files';
import { errorMessage } from '@/shared/api/client';
import { useUser } from '@/shared/auth/session';
import { INSURED_CARD_ROLES } from '../nav';
import { CLAIM_CATEGORY_LABEL, CLAIM_STATUS_LABEL, TRANSITION_LABEL, TRANSITION_TOAST } from '@/shared/domain/claims';
import { LIMIT_CATEGORY_LABEL } from '@/shared/domain/labels';
import { formatDate, formatDateTime, formatFileSize, formatMoney } from '@/shared/lib/format';
import { maskMoney, parseMoney } from '@/shared/lib/masks';
import { useDocumentTitle } from '@/shared/lib/hooks';
import { cn } from '@/shared/lib/cn';
import { Button } from '@/shared/ui/button';
import { ProgressBar, StatusDot } from '@/shared/ui/chips';
import { Modal } from '@/shared/ui/dialog';
import { Field, Textarea } from '@/shared/ui/input';
import { MaskedInput } from '@/shared/ui/masked-input';
import { Card, Kv } from '@/shared/ui/page';
import { ErrorState, SkeletonRows } from '@/shared/ui/states';
import { toast } from '@/shared/ui/toast';
import { Tooltip } from '@/shared/ui/tooltip';
import { SlaCell } from '../components/cells';
import { CLAIM_TONE } from '../components/tones';
import { useTopbar } from '../topbar';

const SOURCE_LABEL = { app: 'Приложение', clinic_invoice: 'Счёт клиники', operator: 'Куратор МИГ', assistance: 'Счёт ассистанса' } as const;

export default function ClaimCardPage() {
  const { claimId = '' } = useParams();
  const q = useClaim(claimId);
  const c = q.data;
  useDocumentTitle('Карточка убытка');
  useTopbar([{ label: 'Убытки', to: '/staff/claims' }, { label: c?.number ?? 'Убыток' }]);
  const [pending, setPending] = useState<ClaimStatus | null>(null);
  const user = useUser();

  if (q.isLoading) return <SkeletonRows rows={10} />;
  if (q.isError || !c) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const canOpenInsured = !!user && (INSURED_CARD_ROLES as string[]).includes(user.role);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-bold num">{c.number}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-muted">
            <StatusDot tone={CLAIM_TONE[c.status]}>{CLAIM_STATUS_LABEL[c.status]}</StatusDot>· {CLAIM_CATEGORY_LABEL[c.category]} · SLA: <SlaCell claim={c} />
          </p>
        </div>
        <TransitionButtons claim={c} onPick={setPending} />
      </div>
      <div className="grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)_320px]">
        <div className="flex flex-col gap-4">
          <Card title="Данные">
            <dl className="divide-y divide-border-soft">
              <Kv label="Застрахованный">
                {canOpenInsured ? (
                  <Link to={`/staff/insured/${c.insuredId}`} className="text-accent-text hover:underline">
                    {c.insuredName}
                  </Link>
                ) : (
                  c.insuredName
                )}
              </Kv>
              <Kv label="Клиент">{c.clientName}</Kv>
              <Kv label="Источник">{SOURCE_LABEL[c.source]}</Kv>
              <Kv label="Где">{c.providerName}</Kv>
              <Kv label="Дата услуги">{formatDate(c.serviceDate)}</Kv>
              <Kv label="Заявлено">
                <span className="num">{formatMoney(c.amountClaimed)}</span>
              </Kv>
              {c.amountApproved !== undefined && (
                <Kv label="Одобрено">
                  <span className="num font-semibold">{formatMoney(c.amountApproved)}</span>
                </Kv>
              )}
              <Kv label="Создан">{formatDateTime(c.createdAt)}</Kv>
            </dl>
          </Card>
          <Card title="Вложения" bodyClassName="p-2">
            {c.attachments.length === 0 ? (
              <p className="p-2 text-muted">Вложений нет</p>
            ) : (
              <ul className="grid grid-cols-2 gap-2">
                {c.attachments.map((a) => (
                  <AttachmentThumb key={a.id} a={a} />
                ))}
              </ul>
            )}
          </Card>
        </div>
        <LimitCheckCard claim={c} />
        <Card title="История" bodyClassName="p-3">
          <ol className="flex flex-col gap-3 border-l border-border pl-3">
            {[...c.history].reverse().map((h, i) => (
              <li key={i} className="relative">
                <span className={cn('absolute -left-[17px] top-1 h-2 w-2 rounded-full', i === 0 ? 'bg-accent' : 'bg-border')} aria-hidden />
                <div className="font-medium">
                  {h.from ? `${CLAIM_STATUS_LABEL[h.from]} → ` : ''}
                  {CLAIM_STATUS_LABEL[h.to]}
                </div>
                <div className="text-[12px] text-muted">
                  {formatDateTime(h.at)} · {h.actorName}
                </div>
                {h.comment && <p className="mt-1 rounded-btn bg-rail px-2 py-1">{h.comment}</p>}
              </li>
            ))}
          </ol>
        </Card>
      </div>
      {pending && <TransitionDialog claim={c} to={pending} onClose={() => setPending(null)} />}
    </div>
  );
}

function TransitionButtons({ claim, onPick }: { claim: ClaimDetail; onPick: (to: ClaimStatus) => void }) {
  const items: { to: ClaimStatus; reason?: string }[] = [
    ...claim.allowedTransitions.map((to) => ({ to })),
    ...claim.blockedTransitions.map((b) => ({ to: b.to, reason: b.reason })),
  ];
  if (items.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {items.map(({ to, reason }) => {
        const btn = (
          <Button
            key={to}
            variant={to === 'rejected' ? 'secondary' : to === 'approved' || to === 'paid' || to === 'to_pay' ? 'primary' : 'soft'}
            className={cn(to === 'rejected' && 'text-danger-text')}
            disabled={!!reason}
            aria-disabled={!!reason || undefined}
            onClick={() => onPick(to)}
          >
            {TRANSITION_LABEL[to]}
          </Button>
        );
        // Disabled buttons do not emit pointer events: wrap to show the rule as a tooltip.
        return reason ? (
          <Tooltip key={to} content={reason}>
            <span tabIndex={0} aria-label={`${TRANSITION_LABEL[to]} недоступно: ${reason}`}>
              {btn}
            </span>
          </Tooltip>
        ) : (
          btn
        );
      })}
    </div>
  );
}

function LimitCheckCard({ claim }: { claim: ClaimDetail }) {
  const l = claim.limitCheck;
  const payout = claim.amountApproved ?? claim.amountClaimed;
  const exceeds = payout > l.remaining;
  const label = LIMIT_CATEGORY_LABEL[l.category];
  return (
    <Card title="Проверка лимита">
      <p className="text-[15px]">
        Лимит «{label}»: использовано <span className="num font-semibold">{formatMoney(l.used)}</span> из{' '}
        <span className="num font-semibold">{formatMoney(l.limit)}</span>, после выплаты останется{' '}
        <span className={cn('num font-semibold', l.remainingAfter < 0 && 'text-danger-text')}>{formatMoney(Math.max(0, l.remainingAfter))}</span>
      </p>
      <ProgressBar className="mt-3 h-3" value={l.used + Math.min(payout, l.remaining)} max={l.limit} warn={(l.used + payout) / l.limit >= 0.8} label={`Лимит «${label}»`} />
      <div className="mt-2 flex justify-between text-[12px] text-muted">
        <span>Использовано + эта выплата</span>
        <span className="num">{formatMoney(l.used + payout, false)} / {formatMoney(l.limit)}</span>
      </div>
      {exceeds && (
        <div role="alert" className="mt-4 flex items-start gap-2 rounded-btn bg-warning-soft px-3 py-2 text-warning-text">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>
            Сумма превышает остаток лимита на {formatMoney(payout - l.remaining)}. Предлагаем одобрить частично — на{' '}
            <span className="num font-semibold">{formatMoney(l.remaining)}</span>.
          </span>
        </div>
      )}
      {claim.medicalReviewRequired && (
        <p className="mt-4 rounded-btn bg-rail px-3 py-2 text-muted">
          Для этого убытка обязательна медэкспертиза: стоматология, стационар или сумма больше 5 000 000 UZS.
        </p>
      )}
    </Card>
  );
}

function AttachmentThumb({ a }: { a: Attachment }) {
  const { src, error } = useFileUrl(a.url);
  const [open, setOpen] = useState(false);
  const [zoom, setZoom] = useState(1);
  useEffect(() => {
    if (!open) setZoom(1);
  }, [open]);
  return (
    <li>
      <button type="button" onClick={() => setOpen(true)} className="flex w-full flex-col gap-1 rounded-btn border border-border p-1.5 text-left hover:bg-rail" aria-label={`Открыть вложение ${a.fileName}`}>
        <span className="flex h-24 items-center justify-center overflow-hidden rounded bg-rail">
          {src ? <img src={src} alt="" className="h-full w-full object-cover" /> : <FileImage className={cn('h-6 w-6', error ? 'text-danger' : 'text-muted')} aria-hidden />}
        </span>
        <span className="truncate text-[12px]">{a.fileName}</span>
        <span className="text-[11px] text-muted">{formatFileSize(a.sizeBytes)}</span>
      </button>
      <Modal open={open} onOpenChange={setOpen} title={a.fileName} wide>
        <div className="mb-2 flex items-center gap-2">
          <Button size="icon" variant="secondary" aria-label="Уменьшить" onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))}>
            <ZoomOut className="h-4 w-4" />
          </Button>
          <span className="w-12 text-center num">{Math.round(zoom * 100)}%</span>
          <Button size="icon" variant="secondary" aria-label="Увеличить" onClick={() => setZoom((z) => Math.min(3, z + 0.25))}>
            <ZoomIn className="h-4 w-4" />
          </Button>
        </div>
        <div className="max-h-[70vh] overflow-auto rounded-btn bg-rail p-2">
          {src ? (
            <img src={src} alt={`Вложение ${a.fileName}`} style={{ width: `${zoom * 100}%`, maxWidth: 'none' }} className="mx-auto block" />
          ) : (
            <p className="p-6 text-center text-muted">{error ? 'Не удалось загрузить файл' : 'Загрузка…'}</p>
          )}
        </div>
      </Modal>
    </li>
  );
}

function TransitionDialog({ claim, to, onClose }: { claim: ClaimDetail; to: ClaimStatus; onClose: () => void }) {
  const transition = useTransition();
  const l = claim.limitCheck;
  const suggested = Math.min(claim.amountClaimed, Math.max(0, l.remaining));
  const [amount, setAmount] = useState(String(suggested || claim.amountClaimed));
  const [comment, setComment] = useState('');
  const [touched, setTouched] = useState(false);
  const isReject = to === 'rejected';
  const isApprove = to === 'approved';
  const amountNum = parseMoney(amount);
  const commentError = isReject && !comment.trim() ? 'Для отказа укажите причину' : undefined;
  const amountError = isApprove && (amountNum <= 0 || amountNum > claim.amountClaimed) ? 'Сумма от 1 до заявленной' : undefined;

  const submit = async () => {
    setTouched(true);
    if (commentError || amountError) return;
    try {
      await transition.mutateAsync({
        claimId: claim.id,
        to,
        amountApproved: isApprove ? amountNum : undefined,
        comment: comment.trim() || (isApprove && amountNum < claim.amountClaimed ? 'Одобрено частично' : undefined),
      });
      toast.success(TRANSITION_TOAST[to]);
      onClose();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title={`${TRANSITION_LABEL[to]}: ${claim.number}`}
      description={
        isReject
          ? 'Застрахованный увидит причину отказа в приложении. Отменить отказ нельзя — только через новое обращение.'
          : isApprove
            ? 'После одобрения убыток уходит бухгалтерии на выплату.'
            : `Статус изменится на «${CLAIM_STATUS_LABEL[to]}». Действие записывается в журнал.`
      }
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Отмена
          </Button>
          <Button variant={isReject ? 'danger' : 'primary'} loading={transition.isPending} onClick={() => void submit()}>
            {TRANSITION_LABEL[to]}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {isApprove && (
          <>
            <Field label="Сумма к выплате, UZS" error={touched ? amountError : undefined} hint={`Заявлено ${formatMoney(claim.amountClaimed)}, остаток лимита ${formatMoney(l.remaining)}`}>
              {(a) => <MaskedInput {...a} mask="money" value={maskMoney(amount)} onChange={setAmount} />}
            </Field>
            {amountNum > l.remaining && (
              <div role="alert" className="flex items-start gap-2 rounded-btn bg-warning-soft px-3 py-2 text-warning-text">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                <span>
                  Больше остатка лимита.{' '}
                  <button type="button" className="font-semibold underline" onClick={() => setAmount(String(l.remaining))}>
                    Одобрить частично на {formatMoney(l.remaining)}
                  </button>
                </span>
              </div>
            )}
          </>
        )}
        <Field label={isReject ? 'Причина отказа' : 'Комментарий'} error={touched ? commentError : undefined} hint={isReject ? 'Понятным языком — её увидит застрахованный' : 'Необязательно'}>
          {(a) => <Textarea {...a} value={comment} maxLength={1000} onChange={(e) => setComment(e.target.value)} onBlur={() => setTouched(true)} />}
        </Field>
      </div>
    </Modal>
  );
}
