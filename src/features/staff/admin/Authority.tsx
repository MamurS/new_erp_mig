/*
 * Personal authority of MIG employees (LIFECYCLE_SPEC §2): an admin proposes, a second person confirms
 * (another admin or an underwriter, never the proposer or the employee whose authority changes).
 */
import { useState } from 'react';
import type { StaffAuthority, StaffUser } from '@/shared/types';
import { useAuthorityChanges, useDecideAuthority, useProposeAuthority } from '@/shared/api/queries/lifecycle';
import { errorMessage } from '@/shared/api/client';
import { useCan } from '@/shared/auth/guards';
import { useUser } from '@/shared/auth/session';
import { authorityChangeSchema, authorityRejectSchema } from '@/shared/schemas/forms';
import { formatDateTime, formatMoney, formatPercent } from '@/shared/lib/format';
import { Button } from '@/shared/ui/button';
import { Modal } from '@/shared/ui/dialog';
import { Field, Input } from '@/shared/ui/input';
import { Card } from '@/shared/ui/page';
import { toast } from '@/shared/ui/toast';
import { ReasonDialog } from '../lifecycle/common';

export function authoritySummary(a: StaffAuthority | undefined, signatory?: { canSign: true; basis: string }): string {
  const parts: string[] = [];
  if (a?.quoteDiscountMaxPct !== undefined) parts.push(`скидка до ${formatPercent(a.quoteDiscountMaxPct)}`);
  if (a?.quotePremiumMax !== undefined) parts.push(`премия до ${formatMoney(a.quotePremiumMax)}`);
  if (a?.claimDecisionMax !== undefined) parts.push(`решения до ${formatMoney(a.claimDecisionMax)}`);
  if (signatory) parts.push(`подписант (${signatory.basis})`);
  return parts.join(' · ') || '—';
}

const num = (s: string) => (s.trim() === '' ? undefined : Number(s.replace(/\s/g, '').replace(',', '.')));

export function AuthorityDialog({ user, onClose }: { user: StaffUser; onClose: () => void }) {
  const propose = useProposeAuthority();
  const a = user.authority ?? {};
  const [discount, setDiscount] = useState(a.quoteDiscountMaxPct !== undefined ? String(Math.round(a.quoteDiscountMaxPct * 1000) / 10) : '');
  const [premium, setPremium] = useState(a.quotePremiumMax !== undefined ? String(a.quotePremiumMax) : '');
  const [claims, setClaims] = useState(a.claimDecisionMax !== undefined ? String(a.claimDecisionMax) : '');
  const [signs, setSigns] = useState(!!user.signatory?.canSign);
  const [basis, setBasis] = useState(user.signatory?.basis ?? '');
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const submit = async () => {
    const d = num(discount);
    const parsed = authorityChangeSchema.safeParse({
      authority: { quoteDiscountMaxPct: d === undefined ? undefined : d / 100, quotePremiumMax: num(premium), claimDecisionMax: num(claims) },
      signatory: signs ? { basis } : null,
      reason,
    });
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [i.path.join('.'), i.message])));
      return;
    }
    try {
      await propose.mutateAsync({ staffId: user.id, body: parsed.data });
      toast.success('Изменение отправлено на подтверждение второму сотруднику');
      onClose();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title={`Полномочия: ${user.fullName}`}
      description="Выше полномочий действие уходит сотруднику той же роли с бо́льшими полномочиями. Изменение вступит в силу после подтверждения вторым сотрудником."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Отмена
          </Button>
          <Button loading={propose.isPending} onClick={() => void submit()}>
            Отправить на подтверждение
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Скидка от тарифа без согласования, %" error={errors['authority.quoteDiscountMaxPct']}>
          {(p) => <Input {...p} inputMode="decimal" maxLength={5} value={discount} onChange={(e) => setDiscount(e.target.value)} />}
        </Field>
        <Field label="Годовая премия котировки до, UZS" error={errors['authority.quotePremiumMax']}>
          {(p) => <Input {...p} inputMode="numeric" maxLength={14} value={premium} onChange={(e) => setPremium(e.target.value)} />}
        </Field>
        <Field label="Решение по убытку до, UZS" error={errors['authority.claimDecisionMax']}>
          {(p) => <Input {...p} inputMode="numeric" maxLength={14} value={claims} onChange={(e) => setClaims(e.target.value)} />}
        </Field>
        <label className="flex items-center gap-2 self-end pb-2 text-[13px]">
          <input type="checkbox" checked={signs} onChange={(e) => setSigns(e.target.checked)} />
          Подписант договоров за МИГ
        </label>
        {signs && (
          <Field label="Основание подписи" className="sm:col-span-2" error={errors['signatory.basis']}>
            {(p) => <Input {...p} maxLength={200} placeholder="Доверенность № 14 от 05.01.2026" value={basis} onChange={(e) => setBasis(e.target.value)} />}
          </Field>
        )}
        <Field label="Основание изменения" className="sm:col-span-2" error={errors.reason}>
          {(p) => <Input {...p} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />}
        </Field>
      </div>
    </Modal>
  );
}

/** Pending and recent authority changes; the second person confirms or rejects here. */
export function AuthorityChangesCard() {
  const me = useUser();
  const canPropose = useCan('staff.authority.manage');
  const canApprove = useCan('staff.authority.manage', { sub: 'approve' });
  const q = useAuthorityChanges(canPropose || canApprove);
  const decide = useDecideAuthority();
  const [reject, setReject] = useState<string | null>(null);
  const list = (q.data ?? []).filter((c) => c.status === 'pending' || canPropose).slice(0, 10);
  if (!(canPropose || canApprove) || list.length === 0) return null;
  return (
    <Card title="Изменения полномочий" className="mb-4" bodyClassName="p-0">
      <ul className="divide-y divide-border-soft text-[13px]" data-testid="authority-changes">
        {list.map((c) => {
          const mine = c.proposedById === me?.id || c.staffId === me?.id;
          return (
            <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
              <span>
                <span className="font-medium">{c.staffName}</span>: {authoritySummary(c.from.authority, c.from.signatory)} → <span className="font-medium">{authoritySummary(c.to.authority, c.to.signatory)}</span>
                <span className="block text-[12px] text-muted">
                  {c.reason} · предложил {c.proposedByName}, {formatDateTime(c.proposedAt)}
                  {c.status === 'applied' && ` · подтвердил ${c.decidedByName ?? ''}`}
                  {c.status === 'rejected' && ` · отклонено: ${c.rejectReason ?? ''}`}
                </span>
              </span>
              {c.status === 'pending' &&
                (mine ? (
                  <span className="text-[12px] text-muted">Ждёт подтверждения другим сотрудником</span>
                ) : (
                  <span className="flex gap-2">
                    <Button size="sm" variant="secondary" onClick={() => setReject(c.id)}>
                      Отклонить
                    </Button>
                    <Button
                      size="sm"
                      loading={decide.isPending}
                      onClick={() =>
                        void decide
                          .mutateAsync({ id: c.id, decision: 'approve' })
                          .then(() => toast.success('Полномочия изменены'))
                          .catch((e: unknown) => toast.error(errorMessage(e)))
                      }
                    >
                      Подтвердить
                    </Button>
                  </span>
                ))}
            </li>
          );
        })}
      </ul>
      <ReasonDialog
        open={!!reject}
        onClose={() => setReject(null)}
        title="Отклонить изменение полномочий"
        description="Полномочия останутся прежними."
        label="Причина"
        field="reason"
        schema={authorityRejectSchema}
        confirmLabel="Отклонить"
        danger
        onSubmit={(reason) => decide.mutateAsync({ id: reject!, decision: 'reject', reason })}
      />
    </Card>
  );
}
