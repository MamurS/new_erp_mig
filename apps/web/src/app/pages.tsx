import { t } from '@/i18n';
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Link, isRouteErrorResponse, useRouteError } from 'react-router-dom';
import { ShieldX, Compass, Bug } from 'lucide-react';
import { useSession } from '@/shared/auth/session';
import { homeFor } from '@mig/domain/auth/home';
import { useDocumentTitle } from '@/shared/lib/hooks';
import { logger } from '@/shared/lib/logger';
import { Button } from '@/shared/ui/button';

function Shell({ icon, title, text, children }: { icon: ReactNode; title: string; text: string; children?: ReactNode }) {
  return (
    <main data-theme="staff" className="flex min-h-screen flex-col items-center justify-center gap-3 p-6 text-center">
      <div className="text-muted">{icon}</div>
      <h1 className="text-[22px] font-bold">{title}</h1>
      <p className="max-w-md text-muted">{text}</p>
      <div className="mt-2 flex gap-2">{children}</div>
    </main>
  );
}

export function ForbiddenPage() {
  useDocumentTitle(t('shell.forbidden.title'));
  const session = useSession();
  return (
    <Shell icon={<ShieldX className="h-10 w-10" />} title={t('shell.forbidden.title')} text={t('shell.forbidden.text')}>
      <Button asChild>
        <Link to={session ? homeFor(session.user.role) : '/login'}>{t('shell.home')}</Link>
      </Button>
    </Shell>
  );
}

export function NotFoundPage() {
  useDocumentTitle(t('shell.notFound.title'));
  const session = useSession();
  return (
    <Shell icon={<Compass className="h-10 w-10" />} title={t('shell.notFound.title')} text={t('shell.notFound.text')}>
      <Button asChild>
        <Link to={session ? homeFor(session.user.role) : '/login'}>{t('shell.home')}</Link>
      </Button>
    </Shell>
  );
}

export function RouteErrorPage() {
  const error = useRouteError();
  if (isRouteErrorResponse(error) && error.status === 404) return <NotFoundPage />;
  logger.error('Route error', { message: error instanceof Error ? error.message : 'unknown' });
  return <CrashScreen />;
}

function CrashScreen() {
  return (
    <Shell icon={<Bug className="h-10 w-10" />} title={t('shell.crash.title')} text={t('shell.crash.text')}>
      <Button onClick={() => window.location.reload()}>{t('shell.crash.reload')}</Button>
    </Shell>
  );
}

export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    logger.error('UI crash', { message: error.message, stack: info.componentStack?.slice(0, 500) });
  }
  render() {
    return this.state.failed ? <CrashScreen /> : this.props.children;
  }
}
