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

const METHOD_LABEL = { qr: 'QR / код', policy: 'Полис и ПИНФЛ', api: 'МИС (API)' } as const;

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
      <span className="text-[12px] text-muted">Визит действует ещё: {left}</span>
    </li>
  );
}

export default function CheckPage() {
  useDocumentTitle('Проверка пациента');
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
      <PageTitle title="Проверка пациента" subtitle="Данные пациента открываются только после проверки полиса: так открывается визит на 24 часа" />
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="QR или код из приложения">
          <form
            className="flex flex-col gap-3 p-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (scan.trim()) void run({ qrToken: scan.trim() });
            }}
          >
            <Field label="Сканер штрихкодов или код из 8 символов" hint="Поле принимает строку сканера MIG-DMS:… и Enter, либо код вида K7P4-QX2M">
              {(a) => <Input {...a} autoFocus autoComplete="off" spellCheck={false} maxLength={200} value={scan} onChange={(e) => setScan(e.target.value)} />}
            </Field>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" loading={check.isPending && !!scan}>
                Проверить код
              </Button>
              <Button type="button" variant="secondary" onClick={() => setCamera((v) => !v)}>
                <Camera className="h-4 w-4" aria-hidden /> Сканировать камерой
              </Button>
            </div>
            {camera && <QrScanner onCode={onCameraCode} onClose={() => setCamera(false)} />}
          </form>
        </Panel>
        <Panel title="Номер полиса и ПИНФЛ">
          <form
            className="grid gap-3 p-4 sm:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              void run({ policyNumber: policy.trim().toUpperCase(), pinfl: digitsOnly(pinfl) });
            }}
          >
            <Field label="Номер полиса">
              {(a) => <Input {...a} autoComplete="off" placeholder="ДМС-2026-000101" maxLength={20} value={policy} onChange={(e) => setPolicy(e.target.value)} />}
            </Field>
            <Field label="ПИНФЛ">
              {(a) => <Input {...a} autoComplete="off" inputMode="numeric" maxLength={14} value={pinfl} onChange={(e) => setPinfl(digitsOnly(e.target.value))} />}
            </Field>
            <p className="text-[12px] text-muted sm:col-span-2">Оба поля обязательны. Не больше 30 проверок в час; после 10 ошибок подряд проверки блокируются на 15 минут.</p>
            <Button type="submit" className="w-fit" disabled={!policy.trim() || pinfl.length !== 14} loading={check.isPending && !scan}>
              Проверить полис
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
                {canRequestGp && <Button onClick={() => setGpOpen(true)}>Запросить гарантийное письмо</Button>}
                <Button variant="secondary" onClick={() => navigate(`/clinic/visits/${result.visitId}`)}>
                  Открыть визит
                </Button>
              </>
            }
          />
          <GuaranteeRequestDialog visitId={result.visitId} open={gpOpen} onOpenChange={setGpOpen} onDone={() => navigate('/clinic/guarantees')} />
        </div>
      )}

      <Panel title="Визиты за сегодня" className="mt-4">
        <QueryState query={visits} skeleton={<SkeletonRows rows={3} className="p-4" />}>
          {(list) =>
            list.length === 0 ? (
              <p className="p-4 text-muted">Сегодня проверок ещё не было</p>
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
