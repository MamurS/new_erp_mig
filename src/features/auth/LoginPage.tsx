import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import type { z } from 'zod';
import { loginSchema } from '@/shared/schemas/forms';
import { useLogin } from '@/shared/api/queries/auth';
import { ApiRequestError, errorMessage } from '@/shared/api/client';
import { takeLogoutNotice, useSession } from '@/shared/auth/session';
import { homeFor } from '@/shared/auth/home';
import { targetAfterLogin } from '@/shared/lib/redirect';
import { useDocumentTitle } from '@/shared/lib/hooks';
import { getDemo } from '@/shared/demo';
import { Button } from '@/shared/ui/button';
import { Field, Input } from '@/shared/ui/input';
import { AuthCard, Notice } from './AuthCard';

type Values = z.infer<typeof loginSchema>;

export default function LoginPage() {
  useDocumentTitle('Вход');
  const session = useSession();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const login = useLogin();
  const [notice] = useState(() => takeLogoutNotice());
  const [serverError, setServerError] = useState<string | null>(null);
  const demo = getDemo();
  const form = useForm<Values>({ resolver: zodResolver(loginSchema), defaultValues: { email: '', password: '' }, mode: 'onTouched' });
  const next = params.get('next');

  useEffect(() => {
    form.setFocus('email');
  }, [form]);

  if (session) return <Navigate to={targetAfterLogin(next, homeFor(session.user.role))} replace />;

  const onSubmit = form.handleSubmit(async (values) => {
    setServerError(null);
    try {
      const res = await login.mutateAsync(values);
      navigate('/login/otp', { state: { challengeId: res.challengeId, resendInSec: res.resendInSec, next } });
    } catch (e) {
      setServerError(e instanceof ApiRequestError ? e.message : errorMessage(e));
      form.setValue('password', '');
      form.setFocus('password');
    }
  });

  return (
    <AuthCard title="Вход" subtitle="Для сотрудников MIG и HR компаний-клиентов">
      {notice && <Notice>{notice}</Notice>}
      {serverError && <Notice tone="danger">{serverError}</Notice>}
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        <Field label="Email" error={form.formState.errors.email?.message}>
          {(a) => <Input {...a} type="email" autoComplete="username" {...form.register('email')} />}
        </Field>
        <Field label="Пароль" error={form.formState.errors.password?.message}>
          {(a) => <Input {...a} type="password" autoComplete="current-password" {...form.register('password')} />}
        </Field>
        <Button type="submit" size="lg" loading={login.isPending} className="mt-1 h-10 text-[14px]">
          Войти
        </Button>
      </form>
      {demo && (
        <demo.StaffLoginHints
          onPick={(email, password) => {
            form.setValue('email', email, { shouldValidate: true });
            form.setValue('password', password, { shouldValidate: true });
          }}
        />
      )}
    </AuthCard>
  );
}
