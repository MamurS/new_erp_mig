import { useEffect, useRef, useState, type RefObject } from 'react';
import { KP_PAGE_COUNT } from '@/shared/domain/kp';
import { cn } from '@/shared/lib/cn';
import { KpFrame } from './KpFrame';
import { KP_PAGE_GAP, KP_PAGE_HEIGHT, KP_PAGE_WIDTH } from './render';

const PREVIEW_HEIGHT = KP_PAGE_COUNT * KP_PAGE_HEIGHT + (KP_PAGE_COUNT - 1) * KP_PAGE_GAP;

/** Pages stacked and scaled to the column width, with a «Страница N из 17» counter. */
export function KpPreview({ frameRef, title, html, className }: { frameRef: RefObject<HTMLIFrameElement | null>; title: string; html: string; className?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.6);
  const [pageNo, setPageNo] = useState(1);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    if (typeof ResizeObserver === 'undefined') return;
    const update = () => setScale(Math.min(1, Math.max(0.2, (el.clientWidth - 32) / KP_PAGE_WIDTH)));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const onScroll = () => {
    const el = box.current;
    if (!el) return;
    const step = (KP_PAGE_HEIGHT + KP_PAGE_GAP) * scale;
    setPageNo(Math.min(KP_PAGE_COUNT, Math.max(1, Math.floor((el.scrollTop + el.clientHeight / 3) / step) + 1)));
  };

  return (
    <section aria-label="Предпросмотр КП" className={cn('relative flex min-w-0 flex-col rounded-card border border-border bg-[#E9E9E7]', className)}>
      <div className="flex items-center justify-between border-b border-border px-4 py-2 text-[12px] text-muted">
        <span>Предпросмотр · {KP_PAGE_COUNT} страниц A4</span>
        <span className="num" aria-live="polite" data-testid="kp-page-counter">
          Страница {pageNo} из {KP_PAGE_COUNT}
        </span>
      </div>
      <div ref={box} onScroll={onScroll} className="h-[calc(100vh-11rem)] min-h-[480px] overflow-y-auto overflow-x-hidden p-4">
        <div className="mx-auto" style={{ width: KP_PAGE_WIDTH * scale, height: PREVIEW_HEIGHT * scale }}>
          <KpFrame
            ref={frameRef}
            title={title}
            html={html}
            className="block origin-top-left border-0 bg-transparent"
            style={{ width: KP_PAGE_WIDTH, height: PREVIEW_HEIGHT, transform: `scale(${scale})` }}
          />
        </div>
      </div>
    </section>
  );
}
