import { t } from '@/i18n';
import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { CalendarPlus, FilePlus2, FileText, SlidersHorizontal, Plus } from 'lucide-react';
import type { Specialty } from '@/shared/types';
import {
  useAppointments,
  useClinics,
  useCreateAppointment,
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
import { APPOINTMENT_STATUS_LABEL, AUDIT_ACTION_LABEL, PROGRAM_LABEL, ROLE_LABEL, SPECIALTY_LABEL } from '@/shared/domain/labels';
import { CLAIM_CATEGORY_LABEL, CLAIM_STATUS_LABEL } from '@/shared/domain/claims';
import { addDaysISO, formatDate, formatDateTime, formatMoney, formatTime, todayISO } from '@/shared/lib/format';
import { useDocumentTitle } from '@/shared/lib/hooks';
import { useCreateIntent } from '@/shared/lib/createIntent';
import { cn } from '@/shared/lib/cn';
import { Button } from '@/shared/ui/button';
import { Chip, StatusDot } from '@/shared/ui/chips';
import { Modal } from '@/shared/ui/dialog';
import { Field, Input, Select } from '@/shared/ui/input';
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
import { MigratedBadge } from '../components/MigratedBadge';
import { NewClaimDialog } from '../components/NewClaimDialog';
import { TableScroll } from '@/shared/ui/table-scroll';

export default function InsuredCardPage() {
  const { insuredId = '' } = useParams();
  // Title never contains the person's name (SPEC §9.4).
  useDocumentTitle(t('staff.insuredCard.title'));
  useTopbar([{ label: t('staff.insuredCard.crumb') }, { label: t('staff.insuredCard.title') }]);
  const q = useInsured(insuredId);
  const canReveal = useCan('insured.reveal_pii');
  const canManageAppts = useCan('appointments.manage');
  const canCreateClaim = useCan('claims.create');
  const canLimit = useCan('limits.request_change');
  const canClaims = useCan('claims.read');
  const [dialog, setDialog] = useState<null | 'book' | 'letter' | 'claim' | 'limit'>(null);
  useCreateIntent('claim', canCreateClaim, setDialog, 'claim');
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
            </Link>
            {t('staff.insuredCard.policyLine')}
            <span className="num">{p.policyNumber}</span> · {PROGRAM_LABEL[p.program]} · {formatDate(p.policyStart)} – {formatDate(p.policyEnd)}
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Chip kind={p.status === 'active' ? 'success' : 'neutral'}>{p.status === 'active' ? t('staff.clientCard.insuredActive') : t('staff.clientCard.insuredExcluded')}</Chip>
            {p.myIdVerified && <Chip kind="accent">MyID ✓</Chip>}
            {p.appStatus === 'active' ? <Chip kind="sky">{t('staff.insuredCard.inApp')}</Chip> : <Chip>{t('staff.insuredCard.notInApp')}</Chip>}
            <MigratedBadge mark={p.migration} oldCertificate={p.externalCertificateNumber} />
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {canManageAppts && (
            <Button variant="secondary" onClick={() => setDialog('book')}>
              <CalendarPlus className="h-3.5 w-3.5" aria-hidden /> {t('staff.insuredCard.book')}
            </Button>
          )}
          {canManageAppts && (
            <Button variant="secondary" onClick={() => setDialog('letter')}>
              <FilePlus2 className="h-3.5 w-3.5" aria-hidden /> {t('staff.insuredCard.guarantee')}
            </Button>
          )}
          {canCreateClaim && (
            <Button variant="secondary" onClick={() => setDialog('claim')}>
              <Plus className="h-3.5 w-3.5" aria-hidden /> {t('staff.insuredCard.claim')}
            </Button>
          )}
          {canLimit && (
            <Button onClick={() => setDialog('limit')}>
              <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden /> {t('staff.limitDialog.title')}
            </Button>
          )}
        </div>
      </div>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">{t('staff.clientCard.tab.overview')}</TabsTrigger>
          <TabsTrigger value="requests">{t('staff.insuredCard.tab.requests')}</TabsTrigger>
          <TabsTrigger value="documents">{t('common.documents')}</TabsTrigger>
          <TabsTrigger value="access">{t('staff.insuredCard.tab.access')}</TabsTrigger>
        </TabsList>
        <TabsContent value="overview">
          <div className="grid gap-4 xl:grid-cols-[minmax(min-content,1fr)_380px]">
            <div className="flex min-w-0 flex-col gap-4">
              <Card title={t('staff.insuredCard.limitsByCategory')}>
                <LimitsBlock insuredId={p.id} />
              </Card>
              {canClaims && (
                <Card title={t('staff.insuredCard.recentRequests')} bodyClassName="p-0">
                  <QueryState query={claims}>
                    {(list) =>
                      list.length === 0 ? (
                        <EmptyState title={t('staff.insuredCard.noRequests')} />
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
            <Card title={t('staff.insuredCard.data')}>
              <dl className="divide-y divide-border-soft">
                <RevealField insuredId={p.id} field="pinfl" masked={p.pinflMasked} canReveal={canReveal} claimNumber={openClaim?.number} />
                <RevealField insuredId={p.id} field="phone" masked={p.phoneMasked} canReveal={canReveal} claimNumber={openClaim?.number} />
                <RevealField insuredId={p.id} field="birthDate" masked={p.birthDateMasked} canReveal={canReveal} claimNumber={openClaim?.number} />
                <div className="flex justify-between gap-2 py-1.5">
                  <dt className="text-muted">{t('common.position')}</dt>
                  <dd>{p.position}</dd>
                </div>
                <div className="flex justify-between gap-2 py-1.5">
                  <dt className="text-muted">{t('staff.insuredCard.insuredFrom')}</dt>
                  <dd>{formatDate(p.insuredFrom)}</dd>
                </div>
                <div className="flex justify-between gap-2 py-1.5">
                  <dt className="text-muted">{t('staff.insuredCard.familyCount')}</dt>
                  <dd>{p.familyMembersCount}</dd>
                </div>
              </dl>
              <p className="mt-3 text-[12px] text-muted">{t('staff.insuredCard.viewsAudited')}</p>
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
      <NewClaimDialog open={dialog === 'claim'} onOpenChange={(o) => setDialog(o ? 'claim' : null)} insured={{ id: p.id, fullName: p.fullName }} />
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
        <Card title={t('staff.clientCard.tab.claims')} bodyClassName="p-0">
          <QueryState query={claims}>
            {(list) =>
              list.length === 0 ? (
                <EmptyState title={t('staff.clientCard.noClaims')} />
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
        <Card title={t('staff.nav.appointments')} bodyClassName="p-0">
          <QueryState query={appts}>
            {(page) =>
              page.items.length === 0 ? (
                <EmptyState title={t('staff.medical.empty')} />
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
            <EmptyState title={t('staff.docs.empty')} />
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
      <p className="px-4 pt-3 text-[12px] text-muted">{t('staff.insuredCard.accessHint')}</p>
      <QueryState query={q}>
        {(list) =>
          list.length === 0 ? (
            <EmptyState title={t('staff.insuredCard.accessEmpty')} />
          ) : (
            <TableScroll className="mt-2">
            <table className="w-full">
              <caption className="sr-only">{t('staff.insuredCard.tab.access')}</caption>
              <thead>
                <tr className="text-left text-[12px] text-muted">
                  <th className="px-4 py-2 font-normal">{t('staff.insuredCard.colTime')}</th>
                  <th className="px-4 py-2 font-normal">{t('common.employee')}</th>
                  <th className="px-4 py-2 font-normal">{t('common.role')}</th>
                  <th className="px-4 py-2 font-normal">{t('staff.insuredCard.colAction')}</th>
                  <th className="px-4 py-2 font-normal">{t('common.reason')}</th>
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
            </TableScroll>
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
      title={t('staff.insuredCard.book')}
      description={t('staff.insuredCard.bookDescription')}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button
            disabled={!slot}
            loading={create.isPending}
            onClick={async () => {
              try {
                await create.mutateAsync({ insuredId, clinicId, specialty, startsAt: slot });
                toast.success(t('staff.insuredCard.booked'));
                onOpenChange(false);
                setSlot('');
              } catch (e) {
                toast.error(errorMessage(e));
              }
            }}
          >
            {t('staff.insuredCard.book')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label={t('staff.insuredCard.doctor')}>
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
        <Field label={t('common.clinic')}>
          {(a) => (
            <Select {...a} value={clinicId} onChange={(e) => { setClinicId(e.target.value); setSlot(''); }}>
              <option value="">{t('staff.insuredCard.chooseClinic')}</option>
              {(clinics.data ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} · {c.district}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t('staff.insuredCard.day')}>
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
            <p className="mb-1 text-[12px] text-muted">{t('staff.insuredCard.colTime')}</p>
            {slots.isLoading ? (
              <SkeletonRows rows={1} />
            ) : (slots.data ?? []).length === 0 ? (
              <p className="text-muted">{t('staff.insuredCard.noSlots')}</p>
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
      title={t('staff.insuredCard.guarantee')}
      description={t('staff.insuredCard.glDescription')}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button
            disabled={!valid}
            loading={letter.isPending}
            onClick={async () => {
              try {
                await letter.mutateAsync({ insuredId, clinicId, service: service.trim() });
                toast.success(t('staff.insuredCard.glCreated'));
                onOpenChange(false);
                setService('');
              } catch (e) {
                toast.error(errorMessage(e));
              }
            }}
          >
            {t('staff.insuredCard.glCreate')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label={t('common.clinic')}>
          {(a) => (
            <Select {...a} value={clinicId} onChange={(e) => setClinicId(e.target.value)}>
              <option value="">{t('staff.insuredCard.chooseClinic')}</option>
              {(clinics.data ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t('common.service')} hint={t('staff.insuredCard.serviceHint')}>
          {(a) => <Input {...a} value={service} maxLength={200} onChange={(e) => setService(e.target.value)} />}
        </Field>
      </div>
    </Modal>
  );
}
