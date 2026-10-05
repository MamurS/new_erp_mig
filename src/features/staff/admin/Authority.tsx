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
import { t, tm } from '@/i18n';
import { formatDateTime, formatMoney, formatPercent } from '@/shared/lib/format';
import { Button } from '@/shared/ui/button';
import { Modal } from '@/shared/ui/dialog';
import { Field, Input } from '@/shared/ui/input';
import { Card } from '@/shared/ui/page';
import { toast } from '@/shared/ui/toast';
import { ReasonDialog } from '../lifecycle/common';

export function authoritySummary(a: StaffAuthority | undefined, signatory?: { canSign: true; basis: string }): string {
  const parts: string[] = [];
  if (a?.quoteDiscountMaxPct !== undefined) parts.push(t('staffOps.authority.discountUpTo', { value: formatPercent(a.quoteDiscountMaxPct) }));
  if (a?.quotePremiumMax !== undefined) parts.push(t('staffOps.authority.premiumUpTo', { value: formatMoney(a.quotePremiumMax) }));
  if (a?.claimDecisionMax !== undefined) parts.push(t('staffOps.authority.decisionsUpTo', { value: formatMoney(a.claimDecisionMax) }));
  if (signatory) parts.push(t('staffOps.authority.signatory', { basis: signatory.basis }));
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
      toast.success(t('staffOps.authority.sent'));
      onClose();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('staffOps.authority.dialogTitle', { name: user.fullName })}
      description={t('staffOps.authority.dialogText')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button loading={propose.isPending} onClick={() => void submit()}>
            {t('staffOps.authority.submit')}
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t('staffOps.authority.discount')} error={tm(errors['authority.quoteDiscountMaxPct']) || undefined}>
          {(p) => <Input {...p} inputMode="decimal" maxLength={5} value={discount} onChange={(e) => setDiscount(e.target.value)} />}
        </Field>
        <Field label={t('staffOps.authority.premium')} error={tm(errors['authority.quotePremiumMax']) || undefined}>
          {(p) => <Input {...p} inputMode="numeric" maxLength={14} value={premium} onChange={(e) => setPremium(e.target.value)} />}
        </Field>
        <Field label={t('staffOps.authority.claims')} error={tm(errors['authority.claimDecisionMax']) || undefined}>
          {(p) => <Input {...p} inputMode="numeric" maxLength={14} value={claims} onChange={(e) => setClaims(e.target.value)} />}
        </Field>
        <label className="flex items-center gap-2 self-end pb-2 text-[13px]">
          <input type="checkbox" checked={signs} onChange={(e) => setSigns(e.target.checked)} />
          {t('staffOps.authority.signs')}
        </label>
        {signs && (
          <Field label={t('staffOps.authority.basis')} className="sm:col-span-2" error={tm(errors['signatory.basis']) || undefined}>
            {(p) => <Input {...p} maxLength={200} placeholder={t('staffOps.authority.basisPlaceholder')} value={basis} onChange={(e) => setBasis(e.target.value)} />}
          </Field>
        )}
        <Field label={t('staffOps.authority.reason')} className="sm:col-span-2" error={tm(errors.reason) || undefined}>
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
    <Card title={t('staffOps.authority.changes')} className="mb-4" bodyClassName="p-0">
      <ul className="divide-y divide-border-soft text-[13px]" data-testid="authority-changes">
        {list.map((c) => {
          const mine = c.proposedById === me?.id || c.staffId === me?.id;
          return (
            <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
              <span>
                <span className="font-medium">{c.staffName}</span>: {authoritySummary(c.from.authority, c.from.signatory)} → <span className="font-medium">{authoritySummary(c.to.authority, c.to.signatory)}</span>
                <span className="block text-[12px] text-muted">
                  {c.reason}
                  {t('staffOps.authority.proposedBy', { name: c.proposedByName, date: formatDateTime(c.proposedAt) })}
                  {c.status === 'applied' && t('staffOps.authority.approvedBy', { name: c.decidedByName ?? '' })}
                  {c.status === 'rejected' && t('staffOps.authority.rejectedWith', { reason: c.rejectReason ?? '' })}
                </span>
              </span>
              {c.status === 'pending' &&
                (mine ? (
                  <span className="text-[12px] text-muted">{t('staffOps.authority.awaiting')}</span>
                ) : (
                  <span className="flex gap-2">
                    <Button size="sm" variant="secondary" onClick={() => setReject(c.id)}>
                      {t('common.reject')}
                    </Button>
                    <Button
                      size="sm"
                      loading={decide.isPending}
                      onClick={() =>
                        void decide
                          .mutateAsync({ id: c.id, decision: 'approve' })
                          .then(() => toast.success(t('staffOps.authority.changed')))
                          .catch((e: unknown) => toast.error(errorMessage(e)))
                      }
                    >
                      {t('common.confirm')}
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
        title={t('staffOps.authority.rejectTitle')}
        description={t('staffOps.authority.rejectText')}
        label={t('common.reason')}
        field="reason"
        schema={authorityRejectSchema}
        confirmLabel={t('common.reject')}
        danger
        onSubmit={(reason) => decide.mutateAsync({ id: reject!, decision: 'reject', reason })}
      />
    </Card>
  );
}
