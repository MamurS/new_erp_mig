import { useEffect, useState } from 'react';
import { Modal } from '@/shared/ui/dialog';
import { Button } from '@/shared/ui/button';
import { formatCountdown } from '@/shared/lib/format';
import { request } from '@/shared/api/client';
import { lastActivity, markActivity } from './activity';
import { idleLimitsFor } from './home';
import { logout } from './logout';
import { useUser } from './session';

/** Inactivity timeout with a countdown warning (SPEC §9.2). */
export function IdleWatcher() {
  const user = useUser();
  const [left, setLeft] = useState<number | null>(null);

  useEffect(() => {
    if (!user) return;
    const { timeoutMs, warnMs } = idleLimitsFor(user.role);
    markActivity();
    const onActivity = () => {
      if (left === null) markActivity();
    };
    window.addEventListener('pointerdown', onActivity);
    window.addEventListener('keydown', onActivity);
    const t = setInterval(() => {
      const idle = Date.now() - lastActivity();
      if (idle >= timeoutMs) {
        clearInterval(t);
        setLeft(null);
        void logout('Сессия завершена из-за неактивности. Войдите снова');
      } else if (warnMs !== null && idle >= warnMs) {
        setLeft(Math.ceil((timeoutMs - idle) / 1000));
      } else {
        setLeft(null);
      }
    }, 1000);
    return () => {
      clearInterval(t);
      window.removeEventListener('pointerdown', onActivity);
      window.removeEventListener('keydown', onActivity);
    };
  }, [user, left === null]); // eslint-disable-line react-hooks/exhaustive-deps

  const stay = () => {
    markActivity();
    setLeft(null);
    void request('/auth/me').catch(() => undefined);
  };

  return (
    <Modal
      open={left !== null}
      onOpenChange={(o) => {
        if (!o) stay();
      }}
      title="Вы ещё здесь?"
      description="Из-за неактивности сессия скоро завершится. Несохранённые данные будут потеряны."
      footer={
        <>
          <Button variant="secondary" onClick={() => void logout()}>
            Выйти
          </Button>
          <Button onClick={stay}>Продолжить работу</Button>
        </>
      }
    >
      <p className="text-center text-[28px] font-bold num" aria-live="polite" data-testid="idle-countdown">
        {formatCountdown(left ?? 0)}
      </p>
    </Modal>
  );
}
