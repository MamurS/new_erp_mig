/*
 * «Моя семья» (FAMILY_SPEC): the people on the employee's policy and the employee's requests to add one
 * (HR approves them into a change request). An adult family member sees the employee only as the policyholder.
 */
import { useState } from 'react';
import { Plus, ShieldCheck, UserRound } from 'lucide-react';
import { useI18n, type I18nKey } from '@/i18n';
import type { FamilyRelation } from '@/shared/types';
import type { FamilyProfile, FamilyRequest, FamilyRequestStatus } from '@/shared/types/dto';
import { ApiRequestError, errorMessage } from '@/shared/api/client';
import { useMe, useMyFamily, useMyFamilyRequests, useRequestFamilyMember } from '@/shared/api/queries/me';
import { FAMILY_RELATIONS, RELATION_LABEL } from '@/shared/domain/family';
import { familyRequestSchema } from '@/shared/schemas/forms';
import { formatDate } from '@/shared/lib/format';
import { useDocumentTitle } from '@/shared/lib/hooks';
import { cn } from '@/shared/lib/cn';
import { Button } from '@/shared/ui/button';
import { Checkbox } from '@/shared/ui/checkbox';
import { Field, Input } from '@/shared/ui/input';
import { MaskedInput } from '@/shared/ui/masked-input';
import { Skeleton } from '@/shared/ui/states';
import { toast } from '@/shared/ui/toast';
import { BIG, CardSkeletons, ChoiceChip, Empty, LoadError, ScreenHeader, Section } from '../components';

const REQUEST_TONE: Record<FamilyRequestStatus, string> = {
  pending: 'bg-sun text-sun-text',
  approved: 'bg-accent-soft text-accent-text',
  rejected: 'bg-danger-soft text-danger-text',
};
const REQUEST_STATUS: Record<FamilyRequestStatus, I18nKey> = {
  pending: 'app.family.req.pending',
  approved: 'app.family.req.approved',
  rejected: 'app.family.req.rejected',
};

function PersonCard({ p, testId }: { p: FamilyProfile; testId: string }) {
  const { t } = useI18n();
  return (
    <li
      className="flex items-start gap-3 rounded-card border border-border bg-surface p-4"
      data-testid={testId}
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent-text">
        <UserRound className="h-5 w-5" aria-hidden />
      </span>
      <div className="min-w-0">
        <p className="font-bold">{p.fullName}</p>
        <p className="text-[14px] text-muted">{RELATION_LABEL[p.relation]}</p>
        {p.certificateNumber && (
          <p className="text-[14px]">
            {t('app.card.certificate')}: <span className="num font-semibold">{p.certificateNumber}</span>
          </p>
        )}
      </div>
    </li>
  );
}

function RequestCard({ r }: { r: FamilyRequest }) {
  const { t } = useI18n();
  return (
    <li className="rounded-card border border-border bg-surface p-4" data-testid="family-request">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-bold">{r.fullName}</p>
          <p className="text-[14px] text-muted">
            {RELATION_LABEL[r.relation]} · {t('app.family.sentOn', { date: formatDate(r.createdAt) })}
          </p>
        </div>
        <span
          className={cn('shrink-0 rounded-full px-2.5 py-1 text-[12px] font-bold', REQUEST_TONE[r.status])}
          data-testid="family-request-status"
        >
          {t(REQUEST_STATUS[r.status])}
        </span>
      </div>
      {r.status === 'pending' && (
        <p className="mt-2 text-[13px] text-muted">{t('app.family.req.pendingHint')}</p>
      )}
      {r.status === 'approved' && (
        <p className="mt-2 text-[13px] text-muted">{t('app.family.req.approvedHint')}</p>
      )}
      {r.status === 'rejected' && r.rejectionReason && (
        <p className="mt-2 text-[13px] font-semibold text-danger-text">
          {t('app.family.req.reason', { reason: r.rejectionReason })}
        </p>
      )}
    </li>
  );
}

type FormKey = 'fullName' | 'birthDate' | 'pinfl' | 'relation' | 'consent';

/** «Добавить члена семьи»: the request goes to HR; the member's consent is confirmed by the employee. */
function AddMemberForm({ onDone }: { onDone: () => void }) {
  const { t } = useI18n();
  const add = useRequestFamilyMember();
  const [fullName, setFullName] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [pinfl, setPinfl] = useState('');
  const [relation, setRelation] = useState<FamilyRelation | null>(null);
  const [isStudent, setIsStudent] = useState(false);
  const [consent, setConsent] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<FormKey, string>>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);

  const submit = async () => {
    setSubmitError(null);
    const parsed = familyRequestSchema.safeParse({
      fullName,
      birthDate,
      pinfl,
      relation: relation ?? undefined,
      ...(relation === 'child' && isStudent ? { isStudent: true } : {}),
      consent,
    });
    if (!parsed.success) {
      const next: Partial<Record<FormKey, string>> = {};
      for (const issue of parsed.error.issues) {
        const k = issue.path[0] as FormKey | undefined;
        if (k && !next[k]) next[k] = issue.message;
      }
      setErrors(next);
      return;
    }
    setErrors({});
    try {
      await add.mutateAsync(parsed.data);
      toast.success(t('app.family.sent'));
      onDone();
    } catch (e) {
      if (e instanceof ApiRequestError && e.fields) setErrors(e.fields as Partial<Record<FormKey, string>>);
      setSubmitError(errorMessage(e));
    } finally {
      add.reset();
    }
  };

  return (
    <form
      noValidate
      aria-label={t('app.family.addTitle')}
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      className="flex flex-col gap-4"
      data-testid="family-add-form"
    >
      <p className="rounded-card bg-sky px-4 py-3 text-[14px] text-sky-text">{t('app.family.addHint')}</p>
      <Field label={t('app.family.f.fullName')} error={errors.fullName} hint={t('app.family.f.fullNameHint')}>
        {(a) => (
          <Input
            {...a}
            value={fullName}
            maxLength={120}
            autoComplete="off"
            onChange={(e) => setFullName(e.target.value)}
            className="h-12 text-[15px]"
          />
        )}
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('app.family.f.birthDate')} error={errors.birthDate}>
          {(a) => (
            <MaskedInput
              {...a}
              mask="date"
              value={birthDate}
              onChange={setBirthDate}
              className="h-12 text-[15px]"
            />
          )}
        </Field>
        <Field label={t('app.family.f.pinfl')} error={errors.pinfl}>
          {(a) => (
            <MaskedInput {...a} mask="pinfl" value={pinfl} onChange={setPinfl} className="h-12 text-[15px]" />
          )}
        </Field>
      </div>
      <fieldset>
        <legend className="mb-2 text-[12px] font-medium text-muted">{t('app.family.f.relation')}</legend>
        <div className="flex flex-wrap gap-2">
          {FAMILY_RELATIONS.map((r) => (
            <ChoiceChip key={r} selected={relation === r} onClick={() => setRelation(r)}>
              {RELATION_LABEL[r]}
            </ChoiceChip>
          ))}
        </div>
        {errors.relation && (
          <p role="alert" className="mt-2 text-[12px] text-danger-text">
            {t('app.family.f.relationRequired')}
          </p>
        )}
      </fieldset>
      {relation === 'child' && (
        <label
          htmlFor="family-student"
          className="flex min-h-[44px] cursor-pointer items-center gap-3 text-[15px]"
        >
          <Checkbox
            id="family-student"
            checked={isStudent}
            onCheckedChange={setIsStudent}
            className="h-6 w-6"
          />
          {t('app.family.f.student')}
        </label>
      )}
      <div>
        <label
          htmlFor="family-consent"
          className="flex min-h-[44px] cursor-pointer items-start gap-3 text-[15px] font-semibold"
        >
          <Checkbox
            id="family-consent"
            checked={consent}
            onCheckedChange={setConsent}
            className="mt-0.5 h-6 w-6"
          />
          {t('app.family.f.consent')}
        </label>
        {errors.consent && (
          <p role="alert" className="mt-1 text-[12px] text-danger-text">
            {t('app.family.f.consentRequired')}
          </p>
        )}
      </div>
      {submitError && (
        <p role="alert" className="rounded-btn bg-danger-soft px-4 py-3 font-semibold text-danger-text">
          {submitError}
        </p>
      )}
      <Button type="submit" loading={add.isPending} className={BIG}>
        {t('app.family.send')}
      </Button>
      <Button type="button" variant="secondary" onClick={onDone} className={BIG}>
        {t('app.common.cancel')}
      </Button>
    </form>
  );
}

function EmployeeFamily() {
  const { t } = useI18n();
  const family = useMyFamily();
  const requests = useMyFamilyRequests();
  const [adding, setAdding] = useState(false);
  const members = (family.data ?? []).filter((p) => p.access !== 'self');

  if (adding) return <AddMemberForm onDone={() => setAdding(false)} />;
  return (
    <>
      <Button onClick={() => setAdding(true)} className={BIG}>
        <Plus className="h-5 w-5" aria-hidden />
        {t('app.family.add')}
      </Button>
      <Section title={t('app.family.members')}>
        {family.isLoading ? (
          <CardSkeletons count={2} />
        ) : family.isError ? (
          <LoadError error={family.error} onRetry={() => void family.refetch()} />
        ) : members.length === 0 ? (
          <Empty title={t('app.family.noMembers')} />
        ) : (
          <ul className="flex flex-col gap-3" aria-label={t('app.family.members')}>
            {members.map((p) => (
              <PersonCard key={p.id} p={p} testId="family-member" />
            ))}
          </ul>
        )}
      </Section>
      <Section title={t('app.family.requests')}>
        {requests.isLoading ? (
          <CardSkeletons count={1} />
        ) : requests.isError ? (
          <LoadError error={requests.error} onRetry={() => void requests.refetch()} />
        ) : (requests.data ?? []).length === 0 ? (
          <Empty title={t('app.family.noRequests')} />
        ) : (
          <ul className="flex flex-col gap-3" aria-label={t('app.family.requests')}>
            {(requests.data ?? []).map((r) => (
              <RequestCard key={r.id} r={r} />
            ))}
          </ul>
        )}
      </Section>
    </>
  );
}

/** An adult family member: the policyholder (names only) and the member's own entry. */
function MemberFamily({ principalName }: { principalName: string }) {
  const { t } = useI18n();
  const family = useMyFamily();
  const self = family.data?.find((p) => p.access === 'self');
  return (
    <>
      <section
        className="flex items-start gap-3 rounded-card bg-accent-soft p-4"
        data-testid="family-principal"
      >
        <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-accent-text" aria-hidden />
        <div>
          <p className="text-[13px] text-muted">{t('app.family.policyholder')}</p>
          <p className="font-bold">{principalName}</p>
          <p className="text-[14px] text-muted">{t('app.family.policyholderHint')}</p>
        </div>
      </section>
      <Section title={t('app.family.you')}>
        {family.isLoading ? (
          <CardSkeletons count={1} />
        ) : family.isError ? (
          <LoadError error={family.error} onRetry={() => void family.refetch()} />
        ) : self ? (
          <ul>
            <PersonCard p={self} testId="family-self" />
          </ul>
        ) : null}
      </Section>
    </>
  );
}

export default function FamilyPage() {
  const { t } = useI18n();
  useDocumentTitle(t('app.family.title'));
  const me = useMe();
  return (
    <div>
      <ScreenHeader title={t('app.family.title')} back="/app/profile" />
      {me.isLoading ? (
        <Skeleton className="h-40 w-full rounded-card" />
      ) : me.isError || !me.data ? (
        <LoadError error={me.error} onRetry={() => void me.refetch()} />
      ) : me.data.relation === 'employee' ? (
        <EmployeeFamily />
      ) : (
        <MemberFamily principalName={me.data.principalName ?? ''} />
      )}
    </div>
  );
}
