/* Patient check (CLINIC_SPEC §4.2): camera, barcode scanner (keyboard wedge) or manual entry. */
import { useCallback, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Camera } from 'lucide-react';
import type { CoverageCheckResult } from '@/shared/types';
import { useCheckPatient, useClinicVisits } from '@/shared/api/queries/clinic';
import { errorMessage } from '@/shared/api/client';
import { useCan } from '@/shared/auth/guards';
import { digitsOnly } from '@/shared/lib/masks';
import { formatTime } from '@/shared/lib/format';
import { useDocumentTitle } from '@/shared/lib/hooks';
import { Button } from '@/shared/ui/button';
import { Field, Input } from '@/shared/ui/input';
import { QueryState, SkeletonRows } from '@/shared/ui/states';
import { CoverageCard, GuaranteeRequestDialog, PageTitle, Panel, useTimeLeft } from '../components';
import { QrScanner } from '../QrScanner';
import { useDmsParam } from '@/shared/api/queries/params';
import { t, defineLabels } from '@/i18n';
import { docNumber } from '@/shared/domain/numbering';

/** Sample policy number (demo template): the same in every language. */
const POLICY_NUMBER_EXAMPLE = docNumber('policy', { year: new Date().getFullYear(), n: 101 });
const METHOD_LABEL = defineLabels('clinic.check.method', ['qr', 'policy', 'api'] as const);

function VisitRow({ v }: { v: { id: string; insuredName: string; method: 'qr' | 'policy' | 'api'; openedAt: string; expiresAt: string } }) {
  const left = useTimeLeft(v.expiresAt);
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
      <span className="min-w-0">
        <Link to={`/clinic/visits/${v.id}`} className="font-semibold text-accent-text hover:underline">
          {v.insuredName}
        </Link>
        <span className="ml-2 text-[12px] text-muted">
          {formatTime(v.openedAt)} · {METHOD_LABEL[v.method]}
        </span>
      </span>
      <span className="text-[12px] text-muted">{t('clinic.check.visitLeft', { left })}</span>
    </li>
  );
}

export default function CheckPage() {
  useDocumentTitle(t('clinic.nav.check'));
  const checksPerHour = useDmsParam('pinflChecksPerHour');
  const failsBeforeLock = useDmsParam('pinflFailsBeforeLock');
  const lockMinutes = useDmsParam('pinflLockMinutes');
  const navigate = useNavigate();
  const check = useCheckPatient();
  const visits = useClinicVisits('today');
  const canRequestGp = useCan('guarantees.request');
  const [scan, setScan] = useState('');
  const [policy, setPolicy] = useState('');
  const [pinfl, setPinfl] = useState('');
  const [camera, setCamera] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CoverageCheckResult | null>(null);
  const [gpOpen, setGpOpen] = useState(false);

  const run = useCallback(
    async (body: { qrToken: string } | { policyNumber: string; pinfl: string }) => {
      setError(null);
      setResult(null);
      try {
        setResult(await check.mutateAsync(body));
        setScan('');
        setPinfl('');
      } catch (e) {
        setError(errorMessage(e));
      }
    },
    [check],
  );
  const onCameraCode = useCallback(
    (text: string) => {
      setCamera(false);
      void run({ qrToken: text });
    },
    [run],
  );

  return (
    <>
      <PageTitle title={t('clinic.nav.check')} subtitle={t('clinic.check.subtitle')} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title={t('clinic.check.qrTitle')}>
          <form
            className="flex flex-col gap-3 p-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (scan.trim()) void run({ qrToken: scan.trim() });
            }}
          >
            <Field label={t('clinic.check.scanLabel')} hint={t('clinic.check.scanHint')}>
              {(a) => <Input {...a} autoFocus autoComplete="off" spellCheck={false} maxLength={200} value={scan} onChange={(e) => setScan(e.target.value)} />}
            </Field>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" loading={check.isPending && !!scan}>
                {t('clinic.check.checkCode')}
              </Button>
              <Button type="button" variant="secondary" onClick={() => setCamera((v) => !v)}>
                <Camera className="h-4 w-4" aria-hidden /> {t('clinic.check.camera')}
              </Button>
            </div>
            {camera && <QrScanner onCode={onCameraCode} onClose={() => setCamera(false)} />}
          </form>
        </Panel>
        <Panel title={t('clinic.check.policyTitle')}>
          <form
            className="grid gap-3 p-4 sm:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              void run({ policyNumber: policy.trim().toUpperCase(), pinfl: digitsOnly(pinfl) });
            }}
          >
            <Field label={t('clinic.check.policyNumber')}>
              {(a) => <Input {...a} autoComplete="off" placeholder={POLICY_NUMBER_EXAMPLE} maxLength={60} value={policy} onChange={(e) => setPolicy(e.target.value)} />}
            </Field>
            <Field label={t('clinic.check.pinfl')}>
              {(a) => <Input {...a} autoComplete="off" inputMode="numeric" maxLength={14} value={pinfl} onChange={(e) => setPinfl(digitsOnly(e.target.value))} />}
            </Field>
            <p className="text-[12px] text-muted sm:col-span-2">{t('clinic.check.limits', { checksPerHour, failsBeforeLock, lockMinutes })}</p>
            <Button type="submit" className="w-fit" disabled={!policy.trim() || pinfl.length !== 14} loading={check.isPending && !scan}>
              {t('clinic.check.checkPolicy')}
            </Button>
          </form>
        </Panel>
      </div>

      {error && (
        <p role="alert" className="mt-4 rounded-card bg-danger-soft px-4 py-3 font-medium text-danger-text" data-testid="check-error">
          {error}
        </p>
      )}
      {result && (
        <div className="mt-4" data-testid="coverage-result">
          <CoverageCard
            result={result}
            actions={
              <>
                {canRequestGp && <Button onClick={() => setGpOpen(true)}>{t('clinic.gpRequest.title')}</Button>}
                <Button variant="secondary" onClick={() => navigate(`/clinic/visits/${result.visitId}`)}>
                  {t('clinic.check.openVisit')}
                </Button>
              </>
            }
          />
          <GuaranteeRequestDialog visitId={result.visitId} open={gpOpen} onOpenChange={setGpOpen} onDone={() => navigate('/clinic/guarantees')} />
        </div>
      )}

      <Panel title={t('clinic.check.todayVisits')} className="mt-4">
        <QueryState query={visits} skeleton={<SkeletonRows rows={3} className="p-4" />}>
          {(list) =>
            list.length === 0 ? (
              <p className="p-4 text-muted">{t('clinic.check.noVisits')}</p>
            ) : (
              <ul className="divide-y divide-border-soft">
                {list.map((v) => (
                  <VisitRow key={v.id} v={v} />
                ))}
              </ul>
            )
          }
        </QueryState>
      </Panel>
    </>
  );
}
