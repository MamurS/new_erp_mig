/*
 * Card of an insured person for the assistance (§6): policy, limits with guarantee reserves, cases,
 * appointments, letters; PII by reason; medical record by reason for the assistance doctor.
 * A former assistance sees the card read-only.
 */
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Lock } from 'lucide-react';
import type { AssistanceCase, Specialty } from '@/shared/types';
import { useAssistBook, useAssistClinics, useAssistPerson, useCreateCase } from '@/shared/api/queries/assist';
import { errorMessage } from '@/shared/api/client';
import { useCan } from '@/shared/auth/guards';
import { CASE_TYPE_LABEL } from '@/shared/domain/assistance';
import { GUARANTEE_STATUS_LABEL } from '@/shared/domain/clinics';
import { SPECIALTY_LABEL } from '@/shared/domain/labels';
import { assistAppointmentSchema, caseCreateSchema } from '@/shared/schemas/forms';
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

const APPT_STATUS = { requested: 'Ждёт клинику', confirmed: 'Подтверждена', declined: 'Отклонена', completed: 'Состоялась', cancelled: 'Отменена' } as const;

export function NewCaseDialog({ insuredId, name, onClose }: { insuredId: string; name: string; onClose: () => void }) {
  const create = useCreateCase();
  const navigate = useNavigate();
  const [type, setType] = useState<AssistanceCase['type']>('appointment');
  const [description, setDescription] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const submit = async () => {
    const parsed = caseCreateSchema.safeParse({ insuredId, type, channel: 'phone', description });
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));
      return;
    }
    try {
      const c = await create.mutateAsync(parsed.data);
      toast.success(`Обращение ${c.number} создано`);
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
      title="Новое обращение"
      description={`${name} · звонок в колл-центр`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Отмена
          </Button>
          <Button loading={create.isPending} onClick={() => void submit()}>
            Создать обращение
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label="Тип" error={errors.type}>
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
        <Field label="Суть обращения" error={errors.description}>
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
      setError('Выберите клинику, врача и время');
      return;
    }
    try {
      await book.mutateAsync(parsed.data);
      toast.success('Заявка отправлена в клинику');
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title="Записать к врачу"
      description="Заявка уйдёт в клинику, клиника подтверждает сама"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Отмена
          </Button>
          <Button loading={book.isPending} onClick={() => void submit()}>
            Записать
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label="Клиника">
          {(a) => (
            <Select
              {...a}
              value={clinicId}
              onChange={(e) => {
                setClinicId(e.target.value);
                setSpecialty('');
              }}
            >
              <option value="">Выберите клинику</option>
              {(clinics.data ?? []).map((c) => (
                <option key={c.clinicId} value={c.clinicId}>
                  {c.clinicName} · {c.city}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Врач">
          {(a) => (
            <Select {...a} value={specialty} disabled={!clinic} onChange={(e) => setSpecialty(e.target.value as Specialty)}>
              <option value="">Выберите специальность</option>
              {(clinic?.specialties ?? []).map((s) => (
                <option key={s} value={s}>
                  {SPECIALTY_LABEL[s]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Дата и время" error={error}>
          {(a) => <Input {...a} type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />}
        </Field>
      </div>
    </Modal>
  );
}

export default function InsuredCardPage() {
  const { insuredId = '' } = useParams();
  const q = useAssistPerson(insuredId);
  useDocumentTitle('Карточка застрахованного');
  useTopbar([{ label: 'Застрахованные', to: '/assist/insured' }, { label: 'Карточка' }]);
  const canReveal = useCan('assist.insured.reveal_pii');
  const canCases = useCan('assist.cases.manage');
  const canBook = useCan('assist.appointments.manage');
  const isDoctor = useCan('assist.medical.read');
  const [dialog, setDialog] = useState<'case' | 'book' | null>(null);

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
                  {p.clientName} · полис <span className="num">{p.policyNumber}</span> · {p.programName}
                </p>
              </div>
              {full ? (
                <div className="flex gap-2">
                  {canCases && (
                    <Button variant="secondary" onClick={() => setDialog('case')}>
                      Новое обращение
                    </Button>
                  )}
                  {canBook && <Button onClick={() => setDialog('book')}>Записать к врачу</Button>}
                </div>
              ) : (
                <Chip kind="warning">
                  <Lock className="h-3 w-3" aria-hidden /> Клиент передан другому ассистансу: только чтение
                </Chip>
              )}
            </div>
            <div className="grid gap-4 lg:grid-cols-3">
              <Card title="Полис и данные">
                <dl className="divide-y divide-border-soft">
                  <Kv label="Срок полиса">
                    <span className="num">
                      {formatDate(p.policyStart)} — {formatDate(p.policyEnd)}
                    </span>
                  </Kv>
                  <Kv label="Статус">{p.status === 'active' ? 'Застрахован' : 'Исключён'}</Kv>
                  <RevealField insuredId={p.id} field="pinfl" masked={p.pinflMasked} canReveal={canReveal && full} apiBase="/assist/insured" />
                  <RevealField insuredId={p.id} field="phone" masked={p.phoneMasked} canReveal={canReveal && full} apiBase="/assist/insured" />
                  <RevealField insuredId={p.id} field="birthDate" masked={p.birthDateMasked} canReveal={canReveal && full} apiBase="/assist/insured" />
                </dl>
              </Card>
              <Card title="Лимиты с учётом резервов ГП" className="lg:col-span-2">
                <LimitBars limits={p.limits} />
              </Card>
            </div>
            <Card title="Обращения" bodyClassName="p-0">
              {p.cases.length === 0 ? (
                <EmptyState title="Обращений нет" />
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
              <Card title="Записи к врачу" bodyClassName="p-0">
                {p.appointments.length === 0 ? (
                  <EmptyState title="Записей нет" />
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
              <Card title="Гарантийные письма" bodyClassName="p-0">
                {p.guarantees.length === 0 ? (
                  <EmptyState title="Писем нет" />
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
          </div>
        );
      }}
    </QueryState>
  );
}
