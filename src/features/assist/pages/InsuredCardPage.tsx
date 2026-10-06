/*
 * Card of an insured person for the assistance (§6): policy, limits with guarantee reserves, cases,
 * appointments, letters; PII by reason; medical record by reason for the assistance doctor.
 * A former assistance sees the card read-only.
 */
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Lock } from 'lucide-react';
import type { AssistanceCase, Specialty } from '@/shared/types';
import { useAssistBook, useAssistClinics, useAssistPerson, useAssistRequestGuarantee, useCreateCase } from '@/shared/api/queries/assist';
import { errorMessage } from '@/shared/api/client';
import { useCan } from '@/shared/auth/guards';
import { CASE_TYPE_LABEL } from '@/shared/domain/assistance';
import { GUARANTEE_STATUS_LABEL } from '@/shared/domain/clinics';
import { SPECIALTY_LABEL } from '@/shared/domain/labels';
import { RELATION_LABEL } from '@/shared/domain/family';
import { assistAppointmentSchema, assistGuaranteeRequestSchema, caseCreateSchema } from '@/shared/schemas/forms';
import { formatDate, formatDateTime, formatMoney } from '@/shared/lib/format';
import { useDocumentTitle } from '@/shared/lib/hooks';
import { Button } from '@/shared/ui/button';
import { Chip } from '@/shared/ui/chips';
import { Modal } from '@/shared/ui/dialog';
import { Field, Input, Select, Textarea } from '@/shared/ui/input';
import { Card, Kv } from '@/shared/ui/page';
import { EmptyState, QueryState } from '@/shared/ui/states';
import { toast } from '@/shared/ui/toast';
import { useTopbar } from '@/features/staff/topbar';
import { LimitBars } from '@/features/staff/components/LimitBars';
import { MedicalCard } from '@/features/staff/components/MedicalCard';
import { RevealField } from '@/features/staff/components/RevealField';
import { CaseStatus, SlaBadge } from '../components';
import { defineLabels, t, tm } from '@/i18n';

const APPT_STATUS = defineLabels('assist.appt', ['requested', 'confirmed', 'declined', 'completed', 'cancelled'] as const);

export function NewCaseDialog({ insuredId, name, onClose }: { insuredId: string; name: string; onClose: () => void }) {
  const create = useCreateCase();
  const navigate = useNavigate();
  const [type, setType] = useState<AssistanceCase['type']>('appointment');
  const [description, setDescription] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const submit = async () => {
    const parsed = caseCreateSchema.safeParse({ insuredId, type, channel: 'phone', description });
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), tm(i.message)])));
      return;
    }
    try {
      const c = await create.mutateAsync(parsed.data);
      toast.success(t('assist.card.caseCreated', { number: c.number }));
      onClose();
      navigate(`/assist/cases/${c.id}`);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('assist.card.newCase')}
      description={t('assist.card.newCaseDescription', { name })}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button loading={create.isPending} onClick={() => void submit()}>
            {t('assist.card.createCase')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label={t('common.type')} error={errors.type}>
          {(a) => (
            <Select {...a} value={type} onChange={(e) => setType(e.target.value as AssistanceCase['type'])}>
              {Object.entries(CASE_TYPE_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t('assist.card.caseEssence')} error={errors.description}>
          {(a) => <Textarea {...a} rows={3} maxLength={1000} value={description} onChange={(e) => setDescription(e.target.value)} />}
        </Field>
      </div>
    </Modal>
  );
}

export function BookDialog({ insuredId, caseId, onClose }: { insuredId: string; caseId?: string; onClose: () => void }) {
  const clinics = useAssistClinics();
  const book = useAssistBook();
  const [clinicId, setClinicId] = useState('');
  const [specialty, setSpecialty] = useState<Specialty | ''>('');
  const [when, setWhen] = useState('');
  const [error, setError] = useState<string>();
  const clinic = clinics.data?.find((c) => c.clinicId === clinicId);
  const submit = async () => {
    const startsAt = when ? `${when}:00+05:00` : '';
    const parsed = assistAppointmentSchema.safeParse({ insuredId, clinicId, specialty, startsAt, caseId });
    if (!parsed.success) {
      setError(t('assist.card.bookError'));
      return;
    }
    try {
      await book.mutateAsync(parsed.data);
      toast.success(t('assist.card.bookSent'));
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('assist.card.bookTitle')}
      description={t('assist.card.bookDescription')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button loading={book.isPending} onClick={() => void submit()}>
            {t('assist.card.book')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label={t('common.clinic')}>
          {(a) => (
            <Select
              {...a}
              value={clinicId}
              onChange={(e) => {
                setClinicId(e.target.value);
                setSpecialty('');
              }}
            >
              <option value="">{t('assist.card.pickClinic')}</option>
              {(clinics.data ?? []).map((c) => (
                <option key={c.clinicId} value={c.clinicId}>
                  {c.clinicName} · {c.city}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t('assist.card.doctor')}>
          {(a) => (
            <Select {...a} value={specialty} disabled={!clinic} onChange={(e) => setSpecialty(e.target.value as Specialty)}>
              <option value="">{t('assist.card.pickSpecialty')}</option>
              {(clinic?.specialties ?? []).map((s) => (
                <option key={s} value={s}>
                  {SPECIALTY_LABEL[s]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t('assist.card.dateTime')} error={error}>
          {(a) => <Input {...a} type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />}
        </Field>
      </div>
    </Modal>
  );
}

export function RequestGuaranteeDialog({ insuredId, caseId, onClose }: { insuredId: string; caseId?: string; onClose: () => void }) {
  const clinics = useAssistClinics();
  const requestGp = useAssistRequestGuarantee();
  const navigate = useNavigate();
  const [clinicId, setClinicId] = useState('');
  const [serviceCode, setServiceCode] = useState('');
  const [icd10, setIcd10] = useState('');
  const [cost, setCost] = useState('');
  const [comment, setComment] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const clinic = clinics.data?.find((c) => c.clinicId === clinicId);
  const services = (clinic?.priceList ?? []).filter((p) => p.requiresGuarantee);
  const submit = async () => {
    const parsed = assistGuaranteeRequestSchema.safeParse({ insuredId, clinicId, serviceCode, icd10, estimatedCost: Number(cost.replace(/\s/g, '')), comment: comment || undefined, caseId });
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), tm(i.message)])));
      return;
    }
    setErrors({});
    try {
      const g = await requestGp.mutateAsync(parsed.data);
      toast.success(t('assist.card.gpRequested', { number: g.number }));
      onClose();
      navigate(`/assist/guarantees/${g.id}`);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  return (
    <Modal
      open
      wide
      onOpenChange={(o) => !o && onClose()}
      title={t('assist.card.gpTitle')}
      description={t('assist.card.gpDescription')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button loading={requestGp.isPending} onClick={() => void submit()}>
            {t('assist.case.requestGuarantee')}
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t('common.clinic')} error={errors.clinicId}>
          {(a) => (
            <Select
              {...a}
              value={clinicId}
              onChange={(e) => {
                setClinicId(e.target.value);
                setServiceCode('');
              }}
            >
              <option value="">{t('assist.card.pickClinic')}</option>
              {(clinics.data ?? []).map((c) => (
                <option key={c.clinicId} value={c.clinicId}>
                  {c.clinicName} · {c.city}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t('common.service')} error={errors.serviceCode}>
          {(a) => (
            <Select
              {...a}
              value={serviceCode}
              disabled={!clinic}
              onChange={(e) => {
                setServiceCode(e.target.value);
                const p = services.find((x) => x.code === e.target.value);
                if (p) setCost(String(p.price));
              }}
            >
              <option value="">{t('assist.card.pickService')}</option>
              {services.map((p) => (
                <option key={p.code} value={p.code}>
                  {p.code} · {p.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t('assist.card.icd10')} error={errors.icd10}>
          {(a) => <Input {...a} maxLength={8} value={icd10} onChange={(e) => setIcd10(e.target.value)} placeholder="G43.9" />}
        </Field>
        <Field label={t('assist.card.estimatedCostUzs')} error={errors.estimatedCost}>
          {(a) => <Input {...a} inputMode="numeric" maxLength={14} value={cost} onChange={(e) => setCost(e.target.value)} />}
        </Field>
        <Field label={t('common.comment')} error={errors.comment} className="sm:col-span-2">
          {(a) => <Textarea {...a} rows={2} maxLength={1000} value={comment} onChange={(e) => setComment(e.target.value)} />}
        </Field>
      </div>
    </Modal>
  );
}

export default function InsuredCardPage() {
  const { insuredId = '' } = useParams();
  const q = useAssistPerson(insuredId);
  useDocumentTitle(t('assist.card.docTitle'));
  useTopbar([{ label: t('assist.insured.title'), to: '/assist/insured' }, { label: t('assist.card.crumb') }]);
  const canReveal = useCan('assist.insured.reveal_pii');
  const canCases = useCan('assist.cases.manage');
  const canBook = useCan('assist.appointments.manage');
  const isDoctor = useCan('assist.medical.read');
  const [dialog, setDialog] = useState<'case' | 'book' | 'gp' | null>(null);

  return (
    <QueryState query={q}>
      {(p) => {
        const full = p.access === 'full';
        return (
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h1 className="text-[22px] font-bold">{p.fullName}</h1>
                <p className="text-muted">
                  {p.clientName} · {t('assist.card.policyLine')} <span className="num">{p.policyNumber}</span> · {p.programName}
                </p>
              </div>
              {full ? (
                <div className="flex gap-2">
                  {canCases && (
                    <Button variant="secondary" onClick={() => setDialog('case')}>
                      {t('assist.card.newCase')}
                    </Button>
                  )}
                  {canCases && (
                    <Button variant="secondary" onClick={() => setDialog('gp')}>
                      {t('assist.case.requestGuarantee')}
                    </Button>
                  )}
                  {canBook && <Button onClick={() => setDialog('book')}>{t('assist.card.bookTitle')}</Button>}
                </div>
              ) : (
                <Chip kind="warning">
                  <Lock className="h-3 w-3" aria-hidden /> {t('assist.case.transferred')}
                </Chip>
              )}
            </div>
            <div className="grid gap-4 lg:grid-cols-3">
              <Card title={t('assist.card.policyAndData')}>
                <dl className="divide-y divide-border-soft">
                  <Kv label={t('assist.card.policyTerm')}>
                    <span className="num">
                      {formatDate(p.policyStart)} — {formatDate(p.policyEnd)}
                    </span>
                  </Kv>
                  <Kv label={t('common.status')}>{p.status === 'active' ? t('assist.insured.active') : t('assist.insured.excluded')}</Kv>
                  {p.relation !== 'employee' && (
                    <Kv label={t('staff.insuredCard.relation')}>
                      <span data-testid="insured-relation">
                        {RELATION_LABEL[p.relation]}
                        {p.principalName ? ` · ${p.principalName}` : ''}
                      </span>
                    </Kv>
                  )}
                  <RevealField insuredId={p.id} field="pinfl" masked={p.pinflMasked} canReveal={canReveal && full} apiBase="/assist/insured" />
                  <RevealField insuredId={p.id} field="phone" masked={p.phoneMasked} canReveal={canReveal && full} apiBase="/assist/insured" />
                  <RevealField insuredId={p.id} field="birthDate" masked={p.birthDateMasked} canReveal={canReveal && full} apiBase="/assist/insured" />
                </dl>
              </Card>
              <Card title={t('assist.card.limits')} className="lg:col-span-2">
                <LimitBars limits={p.limits} />
              </Card>
            </div>
            <Card title={t('assist.card.cases')} bodyClassName="p-0">
              {p.cases.length === 0 ? (
                <EmptyState title={t('assist.card.noCases')} />
              ) : (
                <ul className="divide-y divide-border-soft">
                  {p.cases.map((c) => (
                    <li key={c.id}>
                      <Link to={`/assist/cases/${c.id}`} className="flex flex-wrap items-center gap-3 px-4 py-2.5 hover:bg-rail">
                        <span className="num font-medium">{c.number}</span>
                        <span>{CASE_TYPE_LABEL[c.type]}</span>
                        <span className="min-w-0 flex-1 truncate text-muted">{c.description}</span>
                        <CaseStatus status={c.status} />
                        <SlaBadge dueAt={c.slaDueAt} done={c.status === 'resolved'} />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            <div className="grid gap-4 lg:grid-cols-2">
              <Card title={t('assist.card.appointments')} bodyClassName="p-0">
                {p.appointments.length === 0 ? (
                  <EmptyState title={t('assist.card.noAppointments')} />
                ) : (
                  <ul className="divide-y divide-border-soft">
                    {p.appointments.map((a) => (
                      <li key={a.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                        <span className="num">{formatDateTime(a.startsAt)}</span>
                        <span>{SPECIALTY_LABEL[a.specialty]}</span>
                        <span className="min-w-0 flex-1 truncate text-muted">{a.clinicName}</span>
                        <Chip kind={a.status === 'confirmed' ? 'success' : a.status === 'requested' ? 'sky' : 'neutral'}>{APPT_STATUS[a.status]}</Chip>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
              <Card title={t('assist.card.guarantees')} bodyClassName="p-0">
                {p.guarantees.length === 0 ? (
                  <EmptyState title={t('assist.card.noGuarantees')} />
                ) : (
                  <ul className="divide-y divide-border-soft">
                    {p.guarantees.map((g) => (
                      <li key={g.id}>
                        <Link to={`/assist/guarantees/${g.id}`} className="flex flex-wrap items-center gap-3 px-4 py-2.5 hover:bg-rail">
                          <span className="num font-medium">{g.number}</span>
                          <span className="min-w-0 flex-1 truncate">{g.serviceName}</span>
                          <span className="num">{formatMoney(g.approvedAmount ?? g.estimatedCost)}</span>
                          <Chip kind={g.status === 'approved' ? 'success' : g.status === 'rejected' ? 'danger' : 'sky'}>{GUARANTEE_STATUS_LABEL[g.status]}</Chip>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </div>
            {isDoctor && full && <MedicalCard insuredId={p.id} apiBase="/assist/insured" action="assist.medical.read" />}
            {dialog === 'case' && <NewCaseDialog insuredId={p.id} name={p.fullName} onClose={() => setDialog(null)} />}
            {dialog === 'book' && <BookDialog insuredId={p.id} onClose={() => setDialog(null)} />}
            {dialog === 'gp' && <RequestGuaranteeDialog insuredId={p.id} onClose={() => setDialog(null)} />}
          </div>
        );
      }}
    </QueryState>
  );
}
