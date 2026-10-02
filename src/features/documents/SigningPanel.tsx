/*
 * Signing panel of a contract or an endorsement (LIFECYCLE_SPEC §8): each side separately, any method
 * (E-IMZO, EDO, paper, scan), the paper original. Used in the MIG portal and in the HR cabinet.
 */
import { useRef, useState } from 'react';
import { CheckCircle2, Clock, FileSignature, Printer, Send, Upload } from 'lucide-react';
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
import { toast } from '@/shared/ui/toast';
import { DocPrintButton } from './DocPreview';
import type { StubRenderInput } from './render';

export interface SignableDoc {
  id: string;
  number: string;
  status: string;
  signing: Signing;
}

const SIDE_LABEL = { mig: 'МИГ', client: 'Клиент' } as const;

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
      title="Выберите ключ ЭЦП"
      description={`Подпись за сторону «${SIDE_LABEL[side]}». Демо: имитация E-IMZO, ключ и пароль не проверяются`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Отмена
          </Button>
          <Button
            loading={busy}
            onClick={() => {
              if (!password.trim()) {
                setError('Введите пароль ключа');
                return;
              }
              onSign(cert.serial, password);
            }}
          >
            Подписать
          </Button>
        </>
      }
    >
      <label className="flex cursor-pointer items-start gap-3 rounded-btn border border-accent bg-accent-soft/40 p-3">
        <input type="radio" checked readOnly className="mt-1" aria-label={`Ключ ${cert.owner}`} />
        <span className="text-[13px]">
          <span className="block font-semibold">{cert.owner}</span>
          <span className="block text-muted">
            Сертификат {cert.serial} · действует до {formatDate(cert.validTo)}
          </span>
        </span>
      </label>
      <Field label="Пароль ключа" error={error} className="mt-3">
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
      title="Отправить через ЭДО"
      description="Документ уйдёт оператору ЭДО с подписью МИГ; подпись клиента придёт событием от оператора"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Отмена
          </Button>
          <Button loading={busy} onClick={() => onSend(provider)}>
            Отправить
          </Button>
        </>
      }
    >
      <Field label="Оператор ЭДО">
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
            <CheckCircle2 className="h-3 w-3" aria-hidden /> Подписано
          </Chip>
        ) : state === 'scan_pending' ? (
          <Chip kind="warning">Скан на проверке</Chip>
        ) : state === 'edo_pending' ? (
          <Chip kind="warning">
            <Clock className="h-3 w-3" aria-hidden /> Ждём ЭДО
          </Chip>
        ) : (
          <Chip kind="neutral">Не подписано</Chip>
        )}
      </div>
      {s ? (
        <p className="text-[12px] text-muted">
          {SIGN_METHOD_LABEL[s.method]} · {s.signerName} · {formatDateTime(s.signedAt)}
          {s.certificate && ` · сертификат ${s.certificate.serial}`}
          {s.edoProvider && ` · ${s.edoProvider}`}
          {s.scanVerifiedByName && ` · скан проверил ${s.scanVerifiedByName}`}
        </p>
      ) : state === 'edo_pending' ? (
        <p className="text-[12px] text-muted">Отправлено в {doc.signing.edoPending?.provider}, ждём подписи клиента</p>
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
      toast.error(prepared.error);
      return;
    }
    const form = new FormData();
    form.set('side', scanSide);
    form.set('file', prepared.file);
    await run('Скан загружен и ждёт проверки', { kind, id: doc.id, step: 'scan', body: form });
    if (fileRef.current) fileRef.current.value = '';
  };

  const pendingScans = s.pendingScans ?? [];
  return (
    <Card title="Подписание" actions={<DocPrintButton input={printInput} label="Распечатать два экземпляра" aria-label="Распечатать два экземпляра" />}>
      <div className="grid gap-3 sm:grid-cols-2">
        <SideState doc={doc} side="mig" />
        <SideState doc={doc} side="client" />
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {mode === 'staff' && canSignMig && !s.mig && openForMig && (
          <>
            <Button size="sm" onClick={() => setEimzo('mig')}>
              <FileSignature className="h-3.5 w-3.5" aria-hidden /> Подписать ЭЦП за МИГ
            </Button>
            <Button size="sm" variant="secondary" onClick={() => void run('Подпись МИГ на бумаге отмечена', { kind, id: doc.id, step: 'sign', body: { side: 'mig', method: 'paper' } })}>
              <Printer className="h-3.5 w-3.5" aria-hidden /> Подписано МИГ
            </Button>
          </>
        )}
        {mode === 'staff' && canSignMig && !s.client && !s.edoPending && openForMig && (
          <Button size="sm" variant="secondary" onClick={() => setEdo(true)}>
            <Send className="h-3.5 w-3.5" aria-hidden /> Отправить через ЭДО
          </Button>
        )}
        {mode === 'hr' && !s.client && openForClient && (
          <Button size="sm" onClick={() => setEimzo('client')}>
            <FileSignature className="h-3.5 w-3.5" aria-hidden /> Подписать ЭЦП
          </Button>
        )}
        {((mode === 'hr' && !s.client && openForClient) || (mode === 'staff' && (canVerify || canDraft) && openForMig && (!s.client || !s.mig))) && (
          <span className="flex items-center gap-2">
            {mode === 'staff' && (
              <Select aria-label="Чей скан" className="h-8 w-28" value={scanSide} onChange={(e) => setScanSide(e.target.value as 'mig' | 'client')}>
                <option value="client">клиента</option>
                <option value="mig">МИГ</option>
              </Select>
            )}
            <Button size="sm" variant="secondary" onClick={() => fileRef.current?.click()} loading={step.isPending && step.variables?.step === 'scan'}>
              <Upload className="h-3.5 w-3.5" aria-hidden /> Загрузить скан
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept="application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png"
              className="sr-only"
              aria-label="Файл скана подписанного документа"
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
                Скан подписи стороны «{SIDE_LABEL[p.side]}» загрузил {p.uploadedByName}, {formatDateTime(p.uploadedAt)}. Подпись засчитается после проверки.
              </span>
              {mode === 'staff' && canVerify && (
                <Button size="sm" onClick={() => void run('Скан проверен, подпись засчитана', { kind, id: doc.id, step: 'scan/verify', body: { side: p.side } })}>
                  Скан проверен
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {(s.paperOriginal.required || (mode === 'staff' && s.mig?.method === 'paper')) && (
        <div className="mt-3 rounded-btn border border-border-soft p-3 text-[13px]" data-testid="paper-original">
          <p className="mb-2 font-semibold">Бумажный оригинал</p>
          <p className="text-muted">
            Экземпляр МИГ отправлен клиенту: {s.paperOriginal.migCopySentAt ? formatDate(s.paperOriginal.migCopySentAt) : 'нет'} · Оригинал клиента получен:{' '}
            {s.paperOriginal.clientOriginalReceivedAt ? `${formatDate(s.paperOriginal.clientOriginalReceivedAt)}, ${s.paperOriginal.receivedByName ?? ''}` : 'нет'}
          </p>
          {mode === 'staff' && canOriginals && (
            <div className="mt-2 flex flex-wrap items-end gap-2">
              <Field label="Дата">{(a) => <Input {...a} type="date" className="h-8 w-40" value={date} onChange={(e) => setDate(e.target.value)} />}</Field>
              {s.mig && !s.paperOriginal.migCopySentAt && (
                <Button size="sm" variant="secondary" onClick={() => void run('Отметка сохранена', { kind, id: doc.id, step: 'originals', body: { migCopySentAt: date } })}>
                  Отправлено клиенту
                </Button>
              )}
              {!s.paperOriginal.clientOriginalReceivedAt && (
                <Button size="sm" variant="secondary" onClick={() => void run('Оригинал клиента отмечен как полученный', { kind, id: doc.id, step: 'originals', body: { clientOriginalReceivedAt: date } })}>
                  Оригинал клиента получен
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
            if (await run('Документ подписан ЭЦП', { kind, id: doc.id, step: 'sign', body: { side: eimzo, method: 'eimzo', certificateSerial: serial, password } })) setEimzo(null);
          }}
        />
      )}
      {edo && (
        <EdoDialog
          busy={step.isPending}
          onClose={() => setEdo(false)}
          onSend={async (provider) => {
            if (await run(`Отправлено через ${provider}. Ждём подписи клиента`, { kind, id: doc.id, step: 'edo', body: { provider } })) setEdo(false);
          }}
        />
      )}
    </Card>
  );
}
