/* Attachment picker: PDF, JPEG, PNG up to 10 MB, at most 10 files; images are re-encoded (EXIF/GPS dropped). */
import { useState } from 'react';
import { Paperclip, X } from 'lucide-react';
import { ATTACHMENT_ACCEPT, ATTACHMENT_MAX_FILES, prepareAttachment } from '@/shared/lib/attachments';
import { t, tm } from '@/i18n';

export function FilesPicker({ files, onChange, label }: { files: File[]; onChange: (f: File[]) => void; label?: string }) {
  const [error, setError] = useState<string | null>(null);
  const add = async (list: FileList | null) => {
    if (!list) return;
    setError(null);
    const out = [...files];
    for (const f of [...list]) {
      if (out.length >= ATTACHMENT_MAX_FILES) {
        setError(t('clinic.files.tooMany', { max: ATTACHMENT_MAX_FILES }));
        break;
      }
      const r = await prepareAttachment(f, out.length);
      if ('error' in r) setError(tm(r.error));
      else out.push(r.file);
    }
    onChange(out);
  };
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[12px] font-medium text-muted">{label ?? t('clinic.files.label')}</span>
      <label className="inline-flex w-fit cursor-pointer items-center gap-2 rounded-btn border border-dashed border-border px-3 py-2 text-[14px] hover:bg-rail">
        <Paperclip className="h-4 w-4" aria-hidden /> {t('clinic.files.add')}
        <input type="file" multiple accept={ATTACHMENT_ACCEPT} className="sr-only" onChange={(e) => void add(e.target.files)} aria-label={t('clinic.files.add')} />
      </label>
      <span className="text-[12px] text-muted">{t('clinic.files.hint')}</span>
      {error && (
        <p role="alert" className="text-[12px] text-danger-text">
          {error}
        </p>
      )}
      {files.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {files.map((f, i) => (
            <li key={`${f.name}-${i}`} className="inline-flex items-center gap-1 rounded-btn bg-rail px-2 py-1 text-[12px]">
              {f.name}
              <button type="button" aria-label={t('clinic.files.remove', { name: f.name })} onClick={() => onChange(files.filter((_, k) => k !== i))}>
                <X className="h-3 w-3" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
