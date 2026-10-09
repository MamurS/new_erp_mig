/*
 * The page of an invitation link (`/invite#<token>`): the account's e-mail (masked), a new password, then the way to
 * sign in — the first sign-in sets up the authenticator (TOTP). The token lives in the fragment (never sent to a server
 * by the browser, never in a log) and is taken off the address bar at once.
 */
import { t, tm } from '@/i18n';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link } from 'react-router-dom';
import type { z } from 'zod';
import type { InvitationCheck } from '@mig/contracts';
import { invitationPasswordSchema } from '@mig/contracts/forms';
import { formatDate } from '@mig/domain/lib/format';
import { errorMessage } from '@/shared/api/client';
import { useAcceptInvitation, useInvitationCheck } from '@/shared/api/queries/invitations';
import { useDocumentTitle } from '@/shared/lib/hooks';
import { Button } from '@/shared/ui/button';
import { Field, Input } from '@/shared/ui/input';
import { AuthCard, Notice } from './AuthCard';

type Values = z.infer<typeof invitationPasswordSchema>;
const TOKEN = /^[A-Za-z0-9_-]{32,128}$/;

function readToken(): string | null {
  const v = typeof location !== 'undefined' ? location.hash.slice(1) : '';
  return TOKEN.test(v) ? v : null;
}

export default function InvitePage() {
  useDocumentTitle(t('auth.invite.title'));
  const [token] = useState(readToken);
  const check = useInvitationCheck();
  const accept = useAcceptInvitation();
  const [account, setAccount] = useState<InvitationCheck | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const form = useForm<Values>({ resolver: zodResolver(invitationPasswordSchema), defaultValues: { password: '', confirm: '' }, mode: 'onTouched' });
  const e = form.formState.errors;
  const { mutateAsync: checkToken } = check;

  useEffect(() => {
    // The token leaves the address bar (history, screenshots, a shared screen).
    if (location.hash) history.replaceState(history.state, '', `${location.pathname}${location.search}`);
    if (!token) return;
    checkToken(token)
      .then(setAccount)
      .catch((err: unknown) => setFailure(errorMessage(err)));
  }, [token, checkToken]);

  const submit = form.handleSubmit(async (v) => {
    if (!token) return;
    try {
      await accept.mutateAsync({ token, ...v });
      setDone(true);
    } catch (err) {
      form.reset({ password: '', confirm: '' });
      setFailure(errorMessage(err));
    }
  });

  if (done)
    return (
      <AuthCard title={t('auth.invite.doneTitle')}>
        <p className="text-muted">{t('auth.invite.doneText')}</p>
        <Button asChild size="lg" className="mt-5 h-10 w-full text-[14px]">
          <Link to="/login">{t('auth.invite.toLogin')}</Link>
        </Button>
      </AuthCard>
    );

  if (!token || failure)
    return (
      <AuthCard title={t('auth.invite.failedTitle')}>
        <Notice tone="danger">{failure ?? t('auth.invite.noToken')}</Notice>
        <p className="text-muted">{t('auth.invite.askAgain')}</p>
        <Button asChild variant="secondary" className="mt-4">
          <Link to="/login">{t('auth.invite.toLogin')}</Link>
        </Button>
      </AuthCard>
    );

  if (!account)
    return (
      <AuthCard title={t('auth.invite.title')}>
        <p className="text-muted" role="status">
          {t('auth.invite.checking')}
        </p>
      </AuthCard>
    );

  return (
    <AuthCard title={t('auth.invite.title')} subtitle={t('auth.invite.account', { email: account.email, until: formatDate(account.expiresAt) })}>
      <form onSubmit={(ev) => void submit(ev)} noValidate className="flex flex-col gap-4">
        {/* The account's name for password managers (masked: the full address is not shown here). */}
        <input type="text" name="username" autoComplete="username" value={account.email} readOnly hidden />
        <Field label={t('auth.invite.password')} hint={t('auth.invite.passwordHint')} error={tm(e.password?.message)}>
          {(a) => <Input {...a} type="password" autoComplete="new-password" maxLength={128} {...form.register('password')} />}
        </Field>
        <Field label={t('auth.invite.confirm')} error={tm(e.confirm?.message)}>
          {(a) => <Input {...a} type="password" autoComplete="new-password" maxLength={128} {...form.register('confirm')} />}
        </Field>
        <Button type="submit" size="lg" loading={accept.isPending} className="mt-1 h-10 text-[14px]">
          {t('auth.invite.submit')}
        </Button>
      </form>
    </AuthCard>
  );
}
