/*
 * Preview of a stub document: all pages stacked and scaled to the column, a page counter, and printing
 * to PDF from the same sandboxed frame (KP_SPEC §6 rules apply to every generated document).
 */
import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { Download } from 'lucide-react';
import { cn } from '@/shared/lib/cn';
import { Button, type ButtonProps } from '@/shared/ui/button';
import { toast } from '@/shared/ui/toast';
import { errorMessage } from '@/shared/api/client';
import { DocFrame, printDocFrame } from './DocFrame';
import { DOC_PAGE_GAP, DOC_PAGE_HEIGHT, DOC_PAGE_WIDTH, docPreviewHeight, docSrcdoc, renderStubDocument, type StubRenderInput } from './render';

export const PRINT_HINT = 'В окне печати выберите «Сохранить как PDF»';

export function useStubDocument(input: StubRenderInput | null): { html: string; title: string; pages: number } | null {
  return useMemo(() => {
    if (!input) return null;
    const r = renderStubDocument(input);
    return { html: docSrcdoc(r), title: r.title, pages: r.pagesHtml.length };
  }, [input]);
}

export function DocPreview({
  doc,
  frameRef,
  label,
  className,
  height = 'h-[calc(100vh-12rem)]',
}: {
  doc: { html: string; title: string; pages: number };
  frameRef?: RefObject<HTMLIFrameElement | null>;
  label: string;
  className?: string;
  height?: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.6);
  const [pageNo, setPageNo] = useState(1);
  const total = docPreviewHeight(doc.pages);

  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const update = () => setScale(Math.min(1, Math.max(0.2, (el.clientWidth - 32) / DOC_PAGE_WIDTH)));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const onScroll = () => {
    const el = box.current;
    if (!el) return;
    const step = (DOC_PAGE_HEIGHT + DOC_PAGE_GAP) * scale;
    setPageNo(Math.min(doc.pages, Math.max(1, Math.floor((el.scrollTop + el.clientHeight / 3) / step) + 1)));
  };

  return (
    <section aria-label={label} className={cn('relative flex min-w-0 flex-col rounded-card border border-border bg-[#E9E9E7]', className)}>
      <div className="flex items-center justify-between border-b border-border px-4 py-2 text-[12px] text-muted">
        <span>Предпросмотр · страниц A4: {doc.pages}</span>
        <span className="num" aria-live="polite" data-testid="doc-page-counter">
          Страница {pageNo} из {doc.pages}
        </span>
      </div>
      <div ref={box} onScroll={onScroll} className={cn('min-h-[420px] overflow-y-auto overflow-x-hidden p-4', height)}>
        <div className="mx-auto" style={{ width: DOC_PAGE_WIDTH * scale, height: total * scale }}>
          <DocFrame
            ref={frameRef}
            title={doc.title}
            html={doc.html}
            className="block origin-top-left border-0 bg-transparent"
            style={{ width: DOC_PAGE_WIDTH, height: total, transform: `scale(${scale})` }}
          />
        </div>
      </div>
    </section>
  );
}

/** «Скачать PDF»: renders the document (or several, one after another) into a hidden frame and opens the print dialog. */
export function DocPrintButton({
  input,
  label = 'Скачать PDF',
  title,
  onPrinted,
  ...props
}: { input: () => StubRenderInput | StubRenderInput[] | null; label?: string; title?: string; onPrinted?: () => void } & Omit<ButtonProps, 'onClick' | 'title'>) {
  const [doc, setDoc] = useState<{ html: string; title: string; pages: number } | null>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const start = () => {
    const i = input();
    if (!i || (Array.isArray(i) && !i.length)) return;
    const parts = (Array.isArray(i) ? i : [i]).map(renderStubDocument);
    const r = { title: title ?? parts[0]!.title, pagesHtml: parts.flatMap((p) => p.pagesHtml) };
    setDoc({ html: docSrcdoc(r), title: r.title, pages: r.pagesHtml.length });
  };
  const onLoad = async () => {
    try {
      toast.info(PRINT_HINT);
      await printDocFrame(frame.current);
      onPrinted?.();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setDoc(null);
    }
  };
  return (
    <>
      <Button variant="secondary" size="sm" onClick={start} {...props}>
        <Download className="h-3.5 w-3.5" aria-hidden />
        {label}
      </Button>
      {doc && (
        <DocFrame
          ref={frame}
          html={doc.html}
          title={doc.title}
          hidden
          onLoad={() => void onLoad()}
          style={{ position: 'fixed', left: -10_000, top: 0, width: DOC_PAGE_WIDTH, height: DOC_PAGE_HEIGHT, border: 0 }}
        />
      )}
    </>
  );
}
