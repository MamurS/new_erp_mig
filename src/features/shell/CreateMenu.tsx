/* «+ Создать» in the top bar: what the current role may start, plus documents the system creates itself. */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Building2, ClipboardPlus, FilePlus2, FileSignature, FileText, Handshake, Headset, Hospital, Plus, Receipt, ShieldCheck, UserPlus, Users, type LucideIcon } from 'lucide-react';
import { t } from '@/i18n';
import { useUser } from '@/shared/auth/session';
import { cn } from '@/shared/lib/cn';
import { Button } from '@/shared/ui/button';
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from '@/shared/ui/dropdown';
import { createMenuFor, shouldOpenOnKey, type AutoItemId, type CreateCommand, type CreateItemId } from './createItems';

const ICON: Record<CreateItemId | AutoItemId, LucideIcon> = {
  client: Building2,
  deal: Handshake,
  membership: Users,
  claim: Receipt,
  case: Headset,
  guarantee: ShieldCheck,
  user: UserPlus,
  clinic: Hospital,
  assistance: ClipboardPlus,
  policy: FileText,
  endorsement: FilePlus2,
  kp_contract: FileSignature,
};

export function CreateMenu({ onCommand, className }: { onCommand?: (c: CreateCommand) => void; className?: string }) {
  const user = useUser();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const menu = useMemo(() => createMenuFor(user), [user]);
  const enabled = menu.items.length > 0;

  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (!shouldOpenOnKey(e, document)) return;
      e.preventDefault();
      setOpen(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled]);

  if (!enabled) return null;
  const title = t('create.title');
  return (
    <Menu open={open} onOpenChange={setOpen}>
      <MenuTrigger asChild>
        <Button className={cn('shrink-0 px-2 sm:px-3', className)} aria-label={t('create.button')} aria-keyshortcuts="C" title={title} data-testid="create-menu">
          <Plus className="h-4 w-4" aria-hidden />
          <span className="hidden sm:inline" aria-hidden>
            {t('create.button')}
          </span>
          <kbd className="hidden rounded-sm border border-white/40 px-1 text-[10px] font-normal lg:inline" aria-hidden>
            C
          </kbd>
        </Button>
      </MenuTrigger>
      <MenuContent className="w-72">
        <MenuLabel>{t('create.group.manual')}</MenuLabel>
        {menu.items.map((it) => {
          const Icon = ICON[it.id];
          return (
            <MenuItem
              key={it.id}
              data-create={it.id}
              className="items-start"
              onSelect={() => {
                if (it.command) onCommand?.(it.command);
                else if (it.to) navigate(it.to);
              }}
            >
              <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted" aria-hidden />
              <span className="flex min-w-0 flex-col">
                <span>{t(it.label)}</span>
                {it.hint && <span className="text-[12px] text-muted">{t(it.hint)}</span>}
              </span>
            </MenuItem>
          );
        })}
        {menu.auto.length > 0 && (
          <>
            <MenuSeparator />
            <MenuLabel>{t('create.group.auto')}</MenuLabel>
            {menu.auto.map((a) => {
              const Icon = ICON[a.id];
              const reasonId = `create-auto-${a.id}`;
              return (
                <MenuItem key={a.id} data-create={a.id} disabled aria-describedby={reasonId} title={t(a.reason)} className="items-start data-disabled:cursor-default data-disabled:opacity-100">
                  <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted" aria-hidden />
                  <span className="flex min-w-0 flex-col">
                    <span className="text-muted">{t(a.label)}</span>
                    <span id={reasonId} className="text-[12px] text-muted">
                      {t(a.reason)}
                    </span>
                  </span>
                </MenuItem>
              );
            })}
          </>
        )}
      </MenuContent>
    </Menu>
  );
}
