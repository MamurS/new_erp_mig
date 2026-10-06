/* «Мой сертификат» (LIFECYCLE_SPEC §10): view and download the insured person's certificate. */
import { useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import { useI18n } from '@/i18n';
import { useMyCertificate } from '@/shared/api/queries/lifecycle';
import { ApiRequestError } from '@/shared/api/client';
import { useDocumentTitle } from '@/shared/lib/hooks';
import { certificateDocument } from '@/features/documents/builders';
import { DocPreview, DocPrintButton, useStubDocument } from '@/features/documents/DocPreview';
import { Skeleton } from '@/shared/ui/states';
import { BIG, Empty, LoadError, ScreenHeader } from '../components';
import { PersonNote, usePerson } from '../person';

export default function CertificatePage() {
  const { t } = useI18n();
  useDocumentTitle(t('app.certificate.title'));
  // From the profile («Мой сертификат») always the signed-in person; from home — the person picked there.
  const fromProfile = (useLocation().state as { self?: boolean } | null)?.self === true;
  const picked = usePerson();
  const personId = fromProfile ? undefined : picked.personId;
  const isSelf = fromProfile || picked.isSelf;
  const q = useMyCertificate(personId);
  const input = useMemo(() => (q.data ? certificateDocument(q.data) : null), [q.data]);
  const doc = useStubDocument(input);
  const missing = q.data === null || (q.error instanceof ApiRequestError && q.error.status === 404);
  return (
    <div>
      <ScreenHeader title={t('app.certificate.title')} back={isSelf ? '/app/profile' : '/app'} />
      {!isSelf && <PersonNote />}
      {q.isLoading ? (
        <Skeleton className="h-[420px] w-full rounded-card" />
      ) : missing ? (
        <Empty title={t('app.certificate.none')} />
      ) : q.isError || !q.data || !doc ? (
        <LoadError error={q.error} onRetry={() => void q.refetch()} />
      ) : (
        <>
          <p className="mb-3 rounded-card bg-sky px-4 py-3 text-sky-text">
            {t('app.certificate.number')}: <span className="num font-bold" data-testid="my-certificate-number">{q.data.certificateNumber}</span>
          </p>
          <DocPreview doc={doc} label={t('app.certificate.title')} height="h-[60vh]" />
          <DocPrintButton input={() => input} label={t('app.certificate.download')} className={`${BIG} mt-4 w-full`} size="md" />
        </>
      )}
    </div>
  );
}
