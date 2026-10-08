/* CSV: the shared escaping plus the browser download. */
export * from '@mig/domain/lib/csv';

/** Triggers a browser download of text content. */
export function downloadText(content: string | Blob, fileName: string, mime = 'text/csv;charset=utf-8'): void {
  const blob =
    typeof content === 'string' ? new Blob(['\ufeff', content], { type: mime }) : content;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
