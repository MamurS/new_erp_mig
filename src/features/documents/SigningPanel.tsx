/*
 * Signing panel of a contract or an endorsement (LIFECYCLE_SPEC §8): each side separately, any method
 * (E-IMZO, EDO, paper, scan), the paper original. Used in the MIG portal and in the HR cabinet.
 */
import { useRef, useState } from 'react';
import { CheckCircle2, Clock, FileSignature, Printer, Send, Upload } from 'lucide-react';
import { defineLabels, t, tm } from '@/i18n';
import type { Signing } from '@/shared/types';
import { useDocStep, type DocKind } from '@/shared/api/queries/lifecycle';
import { errorMessage } from '@/shared/api/client';
import { useCan } from '@/shared/auth/guards';
import { useUser } from '@/shared/auth/session';
import { EDO_PROVIDERS, SIGN_METHOD_LABEL, signingSummary } from '@/shared/domain/contracts';
import { prepareScan } from '@/shared/lib/attachments';
import { formatDate, formatDateTime, todayISO } from '@/shared/lib/format';
import { Button } from '@/shared/ui/button';
import { Chip } from '@/shared/ui/chips';
import { Modal } from '@/shared/ui/dialog';
import { Field, Input, Select } from '@/shared/ui/input';
import { Card } from '@/shared/ui/page';
import { EmptyState } from '@/shared/ui/states';
import { toast } from '@/shared/ui/toast';
import { HelpMore } from '@/features/next/NextActions';
import { DocPrintButton } from './DocPreview';
import type { StubRenderInput } from './render';

export interface SignableDoc {
  id: string;
  number: string;
  status: string;
  signing: Signing;
}

const SIDE_LABEL = defineLabels('documents.side', ['mig', 'client'] as const);

/** Demo key of E-IMZO: the real one comes from the local E-IMZO application on the user's computer. */
function demoCertificate(owner: string) {
  const serial = Array.from(owner)
    .reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7)
    .toString(16)
    .toUpperCase()
    .padStart(8, '0')
    .slice(0, 10);
  return { serial, owner, validTo: `${new Date().getFullYear() + 1}-12-31` };
}

function EimzoDialog({ side, onClose, onSign, busy }: { side: 'mig' | 'client'; onClose: () => void; onSign: (serial: string, password: string) => void; busy: boolean }) {
  const user = useUser()!;
  const cert = demoCertificate(user.displayName);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string>();
  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('documents.eimzo.title')}
      description={t('documents.eimzo.description', { side: SIDE_LABEL[side] })}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            loading={busy}
            onClick={() => {
              if (!password.trim()) {
                setError(t('documents.eimzo.passwordRequired'));
                return;
              }
              onSign(cert.serial, password);
            }}
          >
            {t('documents.eimzo.sign')}
          </Button>
        </>
      }
    >
      <label className="flex cursor-pointer items-start gap-3 rounded-btn border border-accent bg-accent-soft/40 p-3">
        <input type="radio" checked readOnly className="mt-1" aria-label={t('documents.eimzo.key', { owner: cert.owner })} />
        <span className="text-[13px]">
          <span className="block font-semibold">{cert.owner}</span>
          <span className="block text-muted">
            {t('documents.eimzo.certificate', { serial: cert.serial, date: formatDate(cert.validTo) })}
          </span>
        </span>
      </label>
      <Field label={t('documents.eimzo.password')} error={error} className="mt-3">
        {(a) => <Input {...a} type="password" autoComplete="off" maxLength={100} value={password} onChange={(e) => setPassword(e.target.value)} />}
      </Field>
    </Modal>
  );
}

function EdoDialog({ onClose, onSend, busy }: { onClose: () => void; onSend: (provider: string) => void; busy: boolean }) {
  const [provider, setProvider] = useState<string>(EDO_PROVIDERS[0]);
  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('documents.edo.title')}
      description={t('documents.edo.description')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button loading={busy} onClick={() => onSend(provider)}>
            {t('common.send')}
          </Button>
        </>
      }
    >
      <Field label={t('documents.edo.provider')}>
        {(a) => (
          <Select {...a} value={provider} onChange={(e) => setProvider(e.target.value)}>
            {EDO_PROVIDERS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </Select>
        )}
      </Field>
    </Modal>
  );
}

function SideState({ doc, side }: { doc: SignableDoc; side: 'mig' | 'client' }) {
  const s = doc.signing[side];
  const state = signingSummary(doc.signing).find((x) => x.side === side)!.state;
  return (
    <div className="rounded-btn border border-border-soft p-3" data-testid={`sign-${side}`}>
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="font-semibold">{SIDE_LABEL[side]}</span>
        {state === 'signed' ? (
          <Chip kind="success">
            <CheckCircle2 className="h-3 w-3" aria-hidden /> {t('documents.state.signed')}
          </Chip>
        ) : state === 'scan_pending' ? (
          <Chip kind="warning">{t('documents.state.scanPending')}</Chip>
        ) : state === 'edo_pending' ? (
          <Chip kind="warning">
            <Clock className="h-3 w-3" aria-hidden /> {t('documents.state.edoPending')}
          </Chip>
        ) : (
          <Chip kind="neutral">{t('documents.state.waiting')}</Chip>
        )}
      </div>
      {s ? (
        <p className="text-[12px] text-muted">
          {SIGN_METHOD_LABEL[s.method]} · {s.signerName} · {formatDateTime(s.signedAt)}
          {s.certificate && t('documents.sig.certificate', { serial: s.certificate.serial })}
          {s.edoProvider && ` · ${s.edoProvider}`}
          {s.scanVerifiedByName && t('documents.sig.scanVerifiedBy', { name: s.scanVerifiedByName })}
        </p>
      ) : state === 'edo_pending' ? (
        <p className="text-[12px] text-muted">{t('documents.sig.edoSent', { provider: doc.signing.edoPending?.provider ?? '' })}</p>
      ) : null}
    </div>
  );
}

export function SigningPanel({ kind, doc, mode, printInput }: { kind: DocKind; doc: SignableDoc; mode: 'staff' | 'hr'; printInput: () => StubRenderInput | null }) {
  const step = useDocStep();
  const canSignMig = useCan('contracts.sign_mig');
  const canVerify = useCan('contracts.verify_scan');
  const canOriginals = useCan('contracts.originals');
  const canDraft = useCan(kind === 'contracts' ? 'contracts.draft' : 'endorsements.manage');
  const [eimzo, setEimzo] = useState<'mig' | 'client' | null>(null);
  const [edo, setEdo] = useState(false);
  const [scanSide, setScanSide] = useState<'mig' | 'client'>('client');
  const fileRef = useRef<HTMLInputElement>(null);
  const [date, setDate] = useState(todayISO());
  const s = doc.signing;
  const openForMig = ['approved', 'sent', 'signing'].includes(doc.status);
  const openForClient = ['sent', 'signing'].includes(doc.status);

  const run = async (label: string, body: Parameters<typeof step.mutateAsync>[0]) => {
    try {
      await step.mutateAsync(body);
      toast.success(label);
      return true;
    } catch (e) {
      toast.error(errorMessage(e));
      return false;
    }
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    const prepared = await prepareScan(file);
    if ('error' in prepared) {
      toast.error(tm(prepared.error));
      return;
    }
    const form = new FormData();
    form.set('side', scanSide);
    form.set('file', prepared.file);
    await run(t('documents.signing.scanUploaded'), { kind, id: doc.id, step: 'scan', body: form });
    if (fileRef.current) fileRef.current.value = '';
  };

  const pendingScans = s.pendingScans ?? [];
  const nothingYet = !s.mig && !s.client && !s.edoPending && pendingScans.length === 0;
  return (
    <Card title={t('documents.signing.title')} actions={<DocPrintButton input={printInput} label={t('documents.signing.printTwo')} aria-label={t('documents.signing.printTwo')} />}>
      <div className="grid gap-3 sm:grid-cols-2">
        <SideState doc={doc} side="mig" />
        <SideState doc={doc} side="client" />
      </div>
      {nothingYet && (
        <EmptyState
          testId="signing-next"
          className="px-2 py-4"
          icon={<FileSignature className="h-6 w-6" aria-hidden />}
          title={t('emptyStaff.signing.title')}
          why={openForMig || openForClient ? t('emptyStaff.signing.why') : t('emptyStaff.signing.whyClosed')}
          next={mode === 'staff' ? t('emptyStaff.signing.nextStaff') : openForClient ? t('emptyStaff.signing.nextHrOpen') : t('emptyStaff.signing.nextHr')}
          help={<HelpMore article="signing" section="signing-methods" />}
        />
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        {mode === 'staff' && canSignMig && !s.mig && openForMig && (
          <>
            <Button size="sm" onClick={() => setEimzo('mig')}>
              <FileSignature className="h-3.5 w-3.5" aria-hidden /> {t('documents.signing.signMig')}
            </Button>
            <Button size="sm" variant="secondary" onClick={() => void run(t('documents.signing.paperMigDone'), { kind, id: doc.id, step: 'sign', body: { side: 'mig', method: 'paper' } })}>
              <Printer className="h-3.5 w-3.5" aria-hidden /> {t('documents.signing.paperMig')}
            </Button>
          </>
        )}
        {mode === 'staff' && canSignMig && !s.client && !s.edoPending && openForMig && (
          <Button size="sm" variant="secondary" onClick={() => setEdo(true)}>
            <Send className="h-3.5 w-3.5" aria-hidden /> {t('documents.signing.sendEdo')}
          </Button>
        )}
        {mode === 'hr' && !s.client && openForClient && (
          <Button size="sm" onClick={() => setEimzo('client')}>
            <FileSignature className="h-3.5 w-3.5" aria-hidden /> {t('documents.signing.signClient')}
          </Button>
        )}
        {((mode === 'hr' && !s.client && openForClient) || (mode === 'staff' && (canVerify || canDraft) && openForMig && (!s.client || !s.mig))) && (
          <span className="flex items-center gap-2">
            {mode === 'staff' && (
              <Select aria-label={t('documents.signing.scanSide')} className="h-8 w-28" value={scanSide} onChange={(e) => setScanSide(e.target.value as 'mig' | 'client')}>
                <option value="client">{t('documents.signing.scanSide.client')}</option>
                <option value="mig">{t('documents.signing.scanSide.mig')}</option>
              </Select>
            )}
            <Button size="sm" variant="secondary" onClick={() => fileRef.current?.click()} loading={step.isPending && step.variables?.step === 'scan'}>
              <Upload className="h-3.5 w-3.5" aria-hidden /> {t('documents.signing.uploadScan')}
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept="application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png"
              className="sr-only"
              aria-label={t('documents.signing.scanFile')}
              onChange={(e) => void onFile(e.target.files?.[0])}
            />
          </span>
        )}
      </div>
      {pendingScans.length > 0 && (
        <ul className="mt-3 flex flex-col gap-2">
          {pendingScans.map((p) => (
            <li key={p.side} className="flex flex-wrap items-center justify-between gap-2 rounded-btn bg-warning-soft px-3 py-2 text-[13px] text-warning-text">
              <span>
                {t('documents.signing.pendingScan', { side: SIDE_LABEL[p.side], name: p.uploadedByName, date: formatDateTime(p.uploadedAt) })}
              </span>
              {mode === 'staff' && canVerify && (
                <Button size="sm" onClick={() => void run(t('documents.signing.scanVerified'), { kind, id: doc.id, step: 'scan/verify', body: { side: p.side } })}>
                  {t('documents.signing.verifyScan')}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {(s.paperOriginal.required || (mode === 'staff' && s.mig?.method === 'paper')) && (
        <div className="mt-3 rounded-btn border border-border-soft p-3 text-[13px]" data-testid="paper-original">
          <p className="mb-2 font-semibold">{t('documents.signing.paperOriginal')}</p>
          <p className="text-muted">
            {t('documents.signing.paperStatus', {
              sent: s.paperOriginal.migCopySentAt ? formatDate(s.paperOriginal.migCopySentAt) : t('documents.signing.no'),
              received: s.paperOriginal.clientOriginalReceivedAt
                ? `${formatDate(s.paperOriginal.clientOriginalReceivedAt)}, ${s.paperOriginal.receivedByName ?? ''}`
                : t('documents.signing.no'),
            })}
          </p>
          {mode === 'staff' && canOriginals && (
            <div className="mt-2 flex flex-wrap items-end gap-2">
              <Field label={t('common.date')}>{(a) => <Input {...a} type="date" className="h-8 w-40" value={date} onChange={(e) => setDate(e.target.value)} />}</Field>
              {s.mig && !s.paperOriginal.migCopySentAt && (
                <Button size="sm" variant="secondary" onClick={() => void run(t('documents.signing.markSaved'), { kind, id: doc.id, step: 'originals', body: { migCopySentAt: date } })}>
                  {t('documents.signing.sentToClient')}
                </Button>
              )}
              {!s.paperOriginal.clientOriginalReceivedAt && (
                <Button size="sm" variant="secondary" onClick={() => void run(t('documents.signing.clientReceivedDone'), { kind, id: doc.id, step: 'originals', body: { clientOriginalReceivedAt: date } })}>
                  {t('documents.signing.clientReceived')}
                </Button>
              )}
            </div>
          )}
        </div>
      )}
      {eimzo && (
        <EimzoDialog
          side={eimzo}
          busy={step.isPending}
          onClose={() => setEimzo(null)}
          onSign={async (serial, password) => {
            if (await run(t('documents.signing.signed'), { kind, id: doc.id, step: 'sign', body: { side: eimzo, method: 'eimzo', certificateSerial: serial, password } })) setEimzo(null);
          }}
        />
      )}
      {edo && (
        <EdoDialog
          busy={step.isPending}
          onClose={() => setEdo(false)}
          onSend={async (provider) => {
            if (await run(t('documents.signing.edoSent', { provider }), { kind, id: doc.id, step: 'edo', body: { provider } })) setEdo(false);
          }}
        />
      )}
    </Card>
  );
}
