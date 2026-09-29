import { useEffect, useRef, useState } from 'react';
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
  // While the warning is open, background clicks/keys do not count: only «Продолжить работу» does.
  const warning = useRef(false);
  const role = user?.role;

  useEffect(() => {
    if (!role) return;
    const { timeoutMs, warnMs } = idleLimitsFor(role);
    markActivity();
    const onActivity = () => {
      if (!warning.current) markActivity();
    };
    window.addEventListener('pointerdown', onActivity);
    window.addEventListener('keydown', onActivity);
    const t = setInterval(() => {
      const idle = Date.now() - lastActivity();
      if (idle >= timeoutMs) {
        clearInterval(t);
        warning.current = false;
        setLeft(null);
        void logout('Сессия завершена из-за неактивности. Войдите снова');
      } else if (warnMs !== null && idle >= warnMs) {
        warning.current = true;
        setLeft(Math.ceil((timeoutMs - idle) / 1000));
      } else {
        warning.current = false;
        setLeft(null);
      }
    }, 1000);
    return () => {
      clearInterval(t);
      window.removeEventListener('pointerdown', onActivity);
      window.removeEventListener('keydown', onActivity);
    };
  }, [role]);

  const stay = () => {
    warning.current = false;
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
