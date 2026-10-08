/*
 * The only place where an HTML string is rendered (KP_SPEC §6.2, LIFECYCLE_SPEC §7.1, see docs/DECISIONS.md).
 * Every generated document (commercial offer, contract, endorsement, certificate, claim decision letter)
 * is shown in a sandboxed iframe WITHOUT `allow-scripts`: nothing inside can run, and document styles do
 * not mix with the app. `allow-same-origin` lets the frame load fonts and images (e.g. /kp/gold/) and lets
 * the parent call print(); `allow-modals` permits the print dialog.
 */
import { forwardRef, type CSSProperties } from 'react';

export interface DocFrameProps {
  /** Complete document built by kpSrcdoc() or docSrcdoc(); every dynamic value in it is escaped. */
  html: string;
  title: string;
  className?: string;
  style?: CSSProperties;
  onLoad?: () => void;
  hidden?: boolean;
}

export const DocFrame = forwardRef<HTMLIFrameElement, DocFrameProps>(({ html, title, className, style, onLoad, hidden }, ref) => (
  <iframe
    ref={ref}
    title={title}
    sandbox="allow-same-origin allow-modals"
    srcDoc={html}
    referrerPolicy="no-referrer"
    className={className}
    style={style}
    onLoad={onLoad}
    aria-hidden={hidden || undefined}
    tabIndex={hidden ? -1 : undefined}
  />
));
DocFrame.displayName = 'DocFrame';

/** Opens the browser print dialog for the frame («Сохранить как PDF»). Call after the download is audited. */
export async function printDocFrame(frame: HTMLIFrameElement | null): Promise<void> {
  const win = frame?.contentWindow;
  if (!win) throw new Error('Document frame is not ready');
  // Fonts load lazily; print only after they are in, otherwise the PDF falls back to system fonts.
  await frame.contentDocument?.fonts?.ready;
  win.print();
}
