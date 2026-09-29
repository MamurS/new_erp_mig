import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { CalendarPlus, FilePlus2, FileText, SlidersHorizontal, Plus } from 'lucide-react';
import type { ClaimCategory, Specialty } from '@/shared/types';
import {
  useAppointments,
  useClinics,
  useCreateAppointment,
  useCreateClaim,
  useGuaranteeLetter,
  useInsured,
  useInsuredAccessLog,
  useInsuredClaims,
  useInsuredDocuments,
  useInsuredLimits,
  useSlots,
} from '@/shared/api/queries/staff';
import { errorMessage } from '@/shared/api/client';
import { useCan } from '@/shared/auth/guards';
import { myClaimSchema } from '@/shared/schemas/forms';
import { APPOINTMENT_STATUS_LABEL, AUDIT_ACTION_LABEL, PROGRAM_LABEL, ROLE_LABEL, SPECIALTY_LABEL } from '@/shared/domain/labels';
import { CLAIM_CATEGORY_LABEL, CLAIM_STATUS_LABEL } from '@/shared/domain/claims';
import { addDaysISO, formatDate, formatDateTime, formatMoney, formatTime, todayISO } from '@/shared/lib/format';
import { maskMoney, parseMoney } from '@/shared/lib/masks';
import { useDocumentTitle } from '@/shared/lib/hooks';
import { cn } from '@/shared/lib/cn';
import { Button } from '@/shared/ui/button';
import { Chip, StatusDot } from '@/shared/ui/chips';
import { Modal } from '@/shared/ui/dialog';
import { Field, Input, Select } from '@/shared/ui/input';
import { MaskedInput } from '@/shared/ui/masked-input';
import { Card } from '@/shared/ui/page';
import { EmptyState, ErrorState, QueryState, SkeletonRows } from '@/shared/ui/states';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/ui/tabs';
import { toast } from '@/shared/ui/toast';
import { LimitBars } from '../components/LimitBars';
import { MedicalCard } from '../components/MedicalCard';
import { RevealField } from '../components/RevealField';
import { LimitRequestDialog } from '../components/LimitRequestDialog';
import { APPT_TONE, CLAIM_TONE } from '../components/tones';
import { useTopbar } from '../topbar';

export default function InsuredCardPage() {
  const { insuredId = '' } = useParams();
  // Title never contains the person's name (SPEC §9.4).
  useDocumentTitle('Карточка застрахованного');
  useTopbar([{ label: 'Застрахованные' }, { label: 'Карточка застрахованного' }]);
  const q = useInsured(insuredId);
  const canReveal = useCan('insured.reveal_pii');
  const canManageAppts = useCan('appointments.manage');
  const canCreateClaim = useCan('claims.create');
  const canLimit = useCan('limits.request_change');
  const canClaims = useCan('claims.read');
  const [dialog, setDialog] = useState<null | 'book' | 'letter' | 'claim' | 'limit'>(null);
  const claims = useInsuredClaims(insuredId);
  const openClaim = claims.data?.find((c) => ['new', 'review', 'medical_review'].includes(c.status));

  if (q.isLoading) return <SkeletonRows rows={10} />;
  if (q.isError || !q.data) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const p = q.data;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-bold leading-tight">{p.fullName}</h1>
          <p className="mt-1 text-muted">
            <Link to={`/staff/clients/${p.clientId}`} className="hover:underline">
              {p.clientName}
            </Link>{' '}
            · полис <span className="num">{p.policyNumber}</span> · {PROGRAM_LABEL[p.program]} · {formatDate(p.policyStart)} – {formatDate(p.policyEnd)}
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Chip kind={p.status === 'active' ? 'success' : 'neutral'}>{p.status === 'active' ? 'Активен' : 'Исключён'}</Chip>
            {p.myIdVerified && <Chip kind="accent">MyID ✓</Chip>}
            {p.appStatus === 'active' ? <Chip kind="sky">В приложении</Chip> : <Chip>Не в приложении</Chip>}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {canManageAppts && (
            <Button variant="secondary" onClick={() => setDialog('book')}>
              <CalendarPlus className="h-3.5 w-3.5" aria-hidden /> Записать к врачу
            </Button>
          )}
          {canManageAppts && (
            <Button variant="secondary" onClick={() => setDialog('letter')}>
              <FilePlus2 className="h-3.5 w-3.5" aria-hidden /> Гарантийное письмо
            </Button>
          )}
          {canCreateClaim && (
            <Button variant="secondary" onClick={() => setDialog('claim')}>
              <Plus className="h-3.5 w-3.5" aria-hidden /> Убыток
            </Button>
          )}
          {canLimit && (
            <Button onClick={() => setDialog('limit')}>
              <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden /> Запросить изменение лимита
            </Button>
          )}
        </div>
      </div>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Обзор</TabsTrigger>
          <TabsTrigger value="requests">Обращения</TabsTrigger>
          <TabsTrigger value="documents">Документы</TabsTrigger>
          <TabsTrigger value="access">Журнал доступа</TabsTrigger>
        </TabsList>
        <TabsContent value="overview">
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
            <div className="flex min-w-0 flex-col gap-4">
              <Card title="Лимиты по категориям">
                <LimitsBlock insuredId={p.id} />
              </Card>
              {canClaims && (
                <Card title="Последние обращения" bodyClassName="p-0">
                  <QueryState query={claims}>
                    {(list) =>
                      list.length === 0 ? (
                        <EmptyState title="Обращений не было" />
                      ) : (
                        <ul className="divide-y divide-border-soft">
                          {list.slice(0, 5).map((c) => (
                            <li key={c.id}>
                              <Link to={`/staff/claims/${c.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-rail/60">
                                <span className="num font-medium">{c.number}</span>
                                <span className="text-muted">{CLAIM_CATEGORY_LABEL[c.category]}</span>
                                <span className="ml-auto num">{formatMoney(c.amountClaimed)}</span>
                                <StatusDot tone={CLAIM_TONE[c.status]} className="w-32">
                                  {CLAIM_STATUS_LABEL[c.status]}
                                </StatusDot>
                              </Link>
                            </li>
                          ))}
                        </ul>
                      )
                    }
                  </QueryState>
                </Card>
              )}
              <MedicalCard insuredId={p.id} />
            </div>
            <Card title="Данные">
              <dl className="divide-y divide-border-soft">
                <RevealField insuredId={p.id} field="pinfl" masked={p.pinflMasked} canReveal={canReveal} claimNumber={openClaim?.number} />
                <RevealField insuredId={p.id} field="phone" masked={p.phoneMasked} canReveal={canReveal} claimNumber={openClaim?.number} />
                <RevealField insuredId={p.id} field="birthDate" masked={p.birthDateMasked} canReveal={canReveal} claimNumber={openClaim?.number} />
                <div className="flex justify-between gap-2 py-1.5">
                  <dt className="text-muted">Должность</dt>
                  <dd>{p.position}</dd>
                </div>
                <div className="flex justify-between gap-2 py-1.5">
                  <dt className="text-muted">Застрахован с</dt>
                  <dd>{formatDate(p.insuredFrom)}</dd>
                </div>
                <div className="flex justify-between gap-2 py-1.5">
                  <dt className="text-muted">Членов семьи</dt>
                  <dd>{p.familyMembersCount}</dd>
                </div>
              </dl>
              <p className="mt-3 text-[12px] text-muted">Каждый просмотр данных попадает в журнал аудита</p>
            </Card>
          </div>
        </TabsContent>
        <TabsContent value="requests">
          <RequestsTab insuredId={p.id} showClaims={canClaims} />
        </TabsContent>
        <TabsContent value="documents">
          <DocumentsTab insuredId={p.id} />
        </TabsContent>
        <TabsContent value="access">
          <AccessLogTab insuredId={p.id} />
        </TabsContent>
      </Tabs>

      <BookDialog open={dialog === 'book'} onOpenChange={(o) => setDialog(o ? 'book' : null)} insuredId={p.id} />
      <GuaranteeDialog open={dialog === 'letter'} onOpenChange={(o) => setDialog(o ? 'letter' : null)} insuredId={p.id} />
      <NewClaimDialog open={dialog === 'claim'} onOpenChange={(o) => setDialog(o ? 'claim' : null)} insuredId={p.id} />
      <LimitRequestDialog open={dialog === 'limit'} onOpenChange={(o) => setDialog(o ? 'limit' : null)} policyId={p.policyId} insuredId={p.id} />
    </div>
  );
}

function LimitsBlock({ insuredId }: { insuredId: string }) {
  const q = useInsuredLimits(insuredId);
  return <QueryState query={q}>{(limits) => <LimitBars limits={limits} />}</QueryState>;
}

function RequestsTab({ insuredId, showClaims }: { insuredId: string; showClaims: boolean }) {
  const claims = useInsuredClaims(insuredId);
  const canAppts = useCan('appointments.read');
  const appts = useAppointments({ insuredId, pageSize: 50, sort: 'startsAt:desc' }, canAppts);
  const navigate = useNavigate();
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {showClaims && (
        <Card title="Убытки" bodyClassName="p-0">
          <QueryState query={claims}>
            {(list) =>
              list.length === 0 ? (
                <EmptyState title="Убытков нет" />
              ) : (
                <ul className="divide-y divide-border-soft">
                  {list.map((c) => (
                    <li key={c.id}>
                      <button type="button" onClick={() => navigate(`/staff/claims/${c.id}`)} className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-rail/60">
                        <span className="num font-medium">{c.number}</span>
                        <span className="text-muted">{formatDate(c.createdAt)}</span>
                        <span className="ml-auto num">{formatMoney(c.amountClaimed)}</span>
                        <StatusDot tone={CLAIM_TONE[c.status]}>{CLAIM_STATUS_LABEL[c.status]}</StatusDot>
                      </button>
                    </li>
                  ))}
                </ul>
              )
            }
          </QueryState>
        </Card>
      )}
      {canAppts && (
        <Card title="Записи к врачу" bodyClassName="p-0">
          <QueryState query={appts}>
            {(page) =>
              page.items.length === 0 ? (
                <EmptyState title="Записей нет" />
              ) : (
                <ul className="divide-y divide-border-soft">
                  {page.items.map((a) => (
                    <li key={a.id} className="flex items-center gap-3 px-4 py-2.5">
                      <span className="w-32 text-muted">{formatDateTime(a.startsAt)}</span>
                      <span>{SPECIALTY_LABEL[a.specialty]}</span>
                      <span className="truncate text-muted">{a.clinicName}</span>
                      <StatusDot tone={APPT_TONE[a.status]} className="ml-auto">
                        {APPOINTMENT_STATUS_LABEL[a.status]}
                      </StatusDot>
                    </li>
                  ))}
                </ul>
              )
            }
          </QueryState>
        </Card>
      )}
    </div>
  );
}

function DocumentsTab({ insuredId }: { insuredId: string }) {
  const q = useInsuredDocuments(insuredId);
  return (
    <Card bodyClassName="p-0">
      <QueryState query={q}>
        {(docs) =>
          docs.length === 0 ? (
            <EmptyState title="Документов нет" />
          ) : (
            <ul className="divide-y divide-border-soft">
              {docs.map((d) => (
                <li key={d.id} className="flex items-center gap-2 px-4 py-2.5">
                  <FileText className="h-4 w-4 text-muted" aria-hidden />
                  <span className="flex-1">{d.title}</span>
                  <span className="text-[12px] text-muted">{formatDate(d.createdAt)}</span>
                </li>
              ))}
            </ul>
          )
        }
      </QueryState>
    </Card>
  );
}

function AccessLogTab({ insuredId }: { insuredId: string }) {
  const q = useInsuredAccessLog(insuredId);
  return (
    <Card bodyClassName="p-0">
      <p className="px-4 pt-3 text-[12px] text-muted">Кто и когда открывал данные этого человека.</p>
      <QueryState query={q}>
        {(list) =>
          list.length === 0 ? (
            <EmptyState title="Данные никто не открывал" />
          ) : (
            <table className="mt-2 w-full">
              <caption className="sr-only">Журнал доступа</caption>
              <thead>
                <tr className="border-b border-border text-left text-[12px] text-muted">
                  <th className="px-4 py-2 font-normal">Время</th>
                  <th className="px-4 py-2 font-normal">Сотрудник</th>
                  <th className="px-4 py-2 font-normal">Роль</th>
                  <th className="px-4 py-2 font-normal">Действие</th>
                  <th className="px-4 py-2 font-normal">Причина</th>
                </tr>
              </thead>
              <tbody>
                {list.map((e) => (
                  <tr key={e.id} className="h-11 border-b border-border-soft">
                    <td className="whitespace-nowrap px-4">{formatDateTime(e.at)}</td>
                    <td className="px-4">{e.actorName}</td>
                    <td className="px-4 text-muted">{ROLE_LABEL[e.actorRole]}</td>
                    <td className="px-4">{AUDIT_ACTION_LABEL[e.action]}</td>
                    <td className="px-4 text-muted">{e.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        }
      </QueryState>
    </Card>
  );
}

function BookDialog({ open, onOpenChange, insuredId }: { open: boolean; onOpenChange: (v: boolean) => void; insuredId: string }) {
  const [specialty, setSpecialty] = useState<Specialty>('therapist');
  const [clinicId, setClinicId] = useState('');
  const [date, setDate] = useState(() => addDaysISO(todayISO(), 1));
  const [slot, setSlot] = useState('');
  const clinics = useClinics({ specialty }, open);
  const slots = useSlots(clinicId || null, date);
  const create = useCreateAppointment();
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDaysISO(todayISO(), i)), []);
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Записать к врачу"
      description="Запись создаётся сразу подтверждённой и уходит в клинику."
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Отмена
          </Button>
          <Button
            disabled={!slot}
            loading={create.isPending}
            onClick={async () => {
              try {
                await create.mutateAsync({ insuredId, clinicId, specialty, startsAt: slot });
                toast.success('Запись к врачу создана');
                onOpenChange(false);
                setSlot('');
              } catch (e) {
                toast.error(errorMessage(e));
              }
            }}
          >
            Записать к врачу
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label="Врач">
          {(a) => (
            <Select {...a} value={specialty} onChange={(e) => { setSpecialty(e.target.value as Specialty); setClinicId(''); setSlot(''); }}>
              {(Object.keys(SPECIALTY_LABEL) as Specialty[]).map((s) => (
                <option key={s} value={s}>
                  {SPECIALTY_LABEL[s]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Клиника">
          {(a) => (
            <Select {...a} value={clinicId} onChange={(e) => { setClinicId(e.target.value); setSlot(''); }}>
              <option value="">Выберите клинику</option>
              {(clinics.data ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} · {c.district}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="День">
          {(a) => (
            <Select {...a} value={date} onChange={(e) => { setDate(e.target.value); setSlot(''); }}>
              {days.map((d) => (
                <option key={d} value={d}>
                  {formatDate(d)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        {clinicId && (
          <div>
            <p className="mb-1 text-[12px] text-muted">Время</p>
            {slots.isLoading ? (
              <SkeletonRows rows={1} />
            ) : (slots.data ?? []).length === 0 ? (
              <p className="text-muted">Нет свободного времени — выберите другой день</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {slots.data!.map((s) => (
                  <button
                    key={s.startsAt}
                    type="button"
                    aria-pressed={slot === s.startsAt}
                    onClick={() => setSlot(s.startsAt)}
                    className={cn('rounded-btn border px-2 py-1 num', slot === s.startsAt ? 'border-accent bg-accent-soft text-accent-text' : 'border-border hover:bg-rail')}
                  >
                    {formatTime(s.startsAt)}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}

function GuaranteeDialog({ open, onOpenChange, insuredId }: { open: boolean; onOpenChange: (v: boolean) => void; insuredId: string }) {
  const clinics = useClinics({}, open);
  const letter = useGuaranteeLetter();
  const [clinicId, setClinicId] = useState('');
  const [service, setService] = useState('');
  const valid = clinicId && service.trim().length >= 3;
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Гарантийное письмо"
      description="Письмо подтверждает клинике оплату услуги по полису. Появится во вкладке «Документы»."
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Отмена
          </Button>
          <Button
            disabled={!valid}
            loading={letter.isPending}
            onClick={async () => {
              try {
                await letter.mutateAsync({ insuredId, clinicId, service: service.trim() });
                toast.success('Гарантийное письмо создано');
                onOpenChange(false);
                setService('');
              } catch (e) {
                toast.error(errorMessage(e));
              }
            }}
          >
            Создать гарантийное письмо
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label="Клиника">
          {(a) => (
            <Select {...a} value={clinicId} onChange={(e) => setClinicId(e.target.value)}>
              <option value="">Выберите клинику</option>
              {(clinics.data ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Услуга" hint="Например: МРТ поясничного отдела">
          {(a) => <Input {...a} value={service} maxLength={200} onChange={(e) => setService(e.target.value)} />}
        </Field>
      </div>
    </Modal>
  );
}

const operatorClaimSchema = myClaimSchema;
type ClaimValues = z.input<typeof operatorClaimSchema>;
const CATS: ClaimCategory[] = ['medicines', 'doctor_visit', 'diagnostics', 'dental', 'inpatient'];

function NewClaimDialog({ open, onOpenChange, insuredId }: { open: boolean; onOpenChange: (v: boolean) => void; insuredId: string }) {
  const create = useCreateClaim();
  const navigate = useNavigate();
  const form = useForm<ClaimValues>({
    resolver: zodResolver(operatorClaimSchema),
    defaultValues: { category: 'doctor_visit', amount: 0, serviceDate: '', providerName: '' },
    mode: 'onTouched',
  });
  const onSubmit = form.handleSubmit(async (v) => {
    try {
      const res = await create.mutateAsync({ insuredId, ...v, amount: v.amount });
      toast.success('Убыток создан');
      onOpenChange(false);
      form.reset();
      navigate(`/staff/claims/${res.id}`);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  });
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Новый убыток"
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Отмена
          </Button>
          <Button loading={create.isPending} onClick={() => void onSubmit()}>
            Создать убыток
          </Button>
        </>
      }
    >
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-3">
        <Field label="Категория">
          {(a) => (
            <Select {...a} {...form.register('category')}>
              {CATS.map((c) => (
                <option key={c} value={c}>
                  {CLAIM_CATEGORY_LABEL[c]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Сумма, UZS" error={form.formState.errors.amount?.message}>
          {(a) => (
            <Controller
              control={form.control}
              name="amount"
              render={({ field }) => (
                <MaskedInput {...a} mask="money" value={field.value ? maskMoney(String(field.value)) : ''} onChange={(v) => field.onChange(parseMoney(v))} onBlur={field.onBlur} />
              )}
            />
          )}
        </Field>
        <Field label="Дата услуги" error={form.formState.errors.serviceDate?.message}>
          {(a) => (
            <Controller
              control={form.control}
              name="serviceDate"
              render={({ field }) => <MaskedInput {...a} mask="date" value={field.value} onChange={field.onChange} onBlur={field.onBlur} />}
            />
          )}
        </Field>
        <Field label="Клиника или аптека" error={form.formState.errors.providerName?.message}>
          {(a) => <Input {...a} maxLength={120} {...form.register('providerName')} />}
        </Field>
      </form>
    </Modal>
  );
}
