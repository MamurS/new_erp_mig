import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Command } from 'cmdk';
import { matchesSearch } from '@/shared/lib/searchNormalize';
import * as D from '@radix-ui/react-dialog';
import { BookOpen, MessageCircleQuestion, Building2, FileSignature, FileText, Receipt, Tag, User, CornerDownLeft } from 'lucide-react';
import type { SessionUser } from '@mig/contracts';
import { can } from '@mig/domain/auth/permissions';
import { useClaims, useClients, useInsuredList, usePolicies } from '@/shared/api/queries/staff';
import { useContracts } from '@/shared/api/queries/lifecycle';
import { useDebounced } from '@/shared/lib/hooks';
import { t, useLocale } from '@/i18n';
import { useHelpSearch } from '@/shared/api/queries/help';
import { useAiStatus } from '@/shared/api/queries/ai';
import type { HelpLocationState } from '@/features/help/HelpScreen';
import { GLOSSARY_ANCHOR } from '@/shared/help/glossary';
import { helpHref } from '@/features/help/paths';
import { INSURED_CARD_ROLES, STAFF_SECTIONS } from './nav';

const itemCls =
  'flex cursor-pointer items-center gap-2 rounded-btn px-2 py-1.5 aria-selected:bg-accent-soft aria-selected:text-accent-text';

/** `claim`: «+ Создать → Убыток» — only insured persons; choosing one opens their card with the claim form. */
export type PaletteMode = 'search' | 'claim';

export function CommandPalette({ open, onOpenChange, user, mode = 'search' }: { open: boolean; onOpenChange: (v: boolean) => void; user: SessionUser; mode?: PaletteMode }) {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const term = useDebounced(q.trim(), 250);
  const enabled = open && term.length >= 2;
  const claimMode = mode === 'claim';
  const canClients = !claimMode && can(user, 'clients.read');
  const canPolicies = !claimMode && can(user, 'policies.read');
  const canInsured = can(user, 'insured.read') && (INSURED_CARD_ROLES as string[]).includes(user.role);
  const canClaims = !claimMode && can(user, 'claims.read');
  const clients = useClients({ q: term, pageSize: 5 }, enabled && canClients);
  const policies = usePolicies({ q: term, pageSize: 5 }, enabled && canPolicies);
  const insured = useInsuredList({ q: term, pageSize: 5 }, enabled && canInsured);
  const claims = useClaims({ q: term, pageSize: 5 }, enabled && canClaims);
  // Contracts by the new number, the old number of a transferred one or the client.
  const canContracts = !claimMode && can(user, 'contracts.read');
  const contracts = useContracts({ q: term }, enabled && canContracts);
  // «Справка»: the server search over the help the role may read.
  const locale = useLocale();
  const helpOn = enabled && !claimMode;
  const help = useHelpSearch(helpOn ? term : '', locale);
  const helpTerms = helpOn ? (help.data?.terms.slice(0, 2) ?? []) : [];
  const helpArticles = helpOn ? (help.data?.articles.slice(0, 5) ?? []) : [];
  // «Спросить в справке: «…»» — the first row of the group; hidden while the AI scenario is off.
  const ai = useAiStatus();
  const helpAsk = helpOn && term.length >= 3 && !!ai.data?.scenarios.help;

  useEffect(() => {
    if (!open) setQ('');
  }, [open]);

  const go = (to: string) => {
    onOpenChange(false);
    navigate(to);
  };
  const sections = STAFF_SECTIONS.filter((s) => s.inNav && (s.roles as string[]).includes(user.role));

  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-50 bg-black/30" />
        <D.Content
          data-theme="staff"
          className="animate-modal fixed left-1/2 top-[12vh] z-50 w-[calc(100vw-24px)] max-w-xl -translate-x-1/2 overflow-hidden rounded-card border border-border bg-surface shadow-2xl"
        >
          <D.Title className="sr-only">{claimMode ? t('create.claimPick.title') : t('staff.palette.title')}</D.Title>
          <D.Description className="sr-only">{t('staff.palette.description')}</D.Description>
          <Command shouldFilter={false} label={claimMode ? t('create.claimPick.title') : t('staff.palette.title')} loop>
            <Command.Input
              value={q}
              onValueChange={setQ}
              maxLength={100}
              placeholder={claimMode ? t('create.claimPick.placeholder') : t('staff.palette.placeholder')}
              className="h-12 w-full border-b border-border bg-transparent px-4 outline-hidden"
            />
            <Command.List className="max-h-[60vh] overflow-y-auto p-2">
              <Command.Empty className="px-2 py-6 text-center text-muted">
                {term.length < 2 ? t('staff.palette.minChars') : t('common.notFound')}
              </Command.Empty>
              {canClients && (clients.data?.items.length ?? 0) > 0 && (
                <Command.Group heading={t('staff.palette.clients')} className="text-[12px] text-muted **:[[cmdk-group-items]]:text-[13px] **:[[cmdk-group-items]]:text-text">
                  {clients.data!.items.map((c) => (
                    <Command.Item key={c.id} value={`c-${c.id}`} onSelect={() => go(`/staff/clients/${c.id}`)} className={itemCls}>
                      <Building2 className="h-4 w-4 text-muted" aria-hidden /> {c.name}
                      <span className="ml-auto text-[12px] text-muted num">{c.inn}</span>
                    </Command.Item>
                  ))}
                </Command.Group>
              )}
              {canPolicies && (policies.data?.items.length ?? 0) > 0 && (
                <Command.Group heading={t('staff.palette.policies')} className="text-[12px] text-muted **:[[cmdk-group-items]]:text-[13px] **:[[cmdk-group-items]]:text-text">
                  {policies.data!.items.map((p) => (
                    <Command.Item key={p.id} value={`p-${p.id}`} onSelect={() => go(`/staff/policies/${p.id}`)} className={itemCls}>
                      <FileText className="h-4 w-4 text-muted" aria-hidden /> <span className="num">{p.number}</span>
                      <span className="ml-auto truncate text-[12px] text-muted">{p.clientName}</span>
                    </Command.Item>
                  ))}
                </Command.Group>
              )}
              {canInsured && (insured.data?.items.length ?? 0) > 0 && (
                <Command.Group heading={t('staff.palette.insured')} className="text-[12px] text-muted **:[[cmdk-group-items]]:text-[13px] **:[[cmdk-group-items]]:text-text">
                  {insured.data!.items.map((i) => (
                    <Command.Item key={i.id} value={`i-${i.id}`} onSelect={() => go(claimMode ? `/staff/insured/${i.id}?create=claim` : `/staff/insured/${i.id}`)} className={itemCls}>
                      <User className="h-4 w-4 text-muted" aria-hidden /> {i.fullName}
                      <span className="ml-auto truncate text-[12px] text-muted">{i.clientName}</span>
                    </Command.Item>
                  ))}
                </Command.Group>
              )}
              {canClaims && (claims.data?.items.length ?? 0) > 0 && (
                <Command.Group heading={t('staff.palette.claims')} className="text-[12px] text-muted **:[[cmdk-group-items]]:text-[13px] **:[[cmdk-group-items]]:text-text">
                  {claims.data!.items.map((c) => (
                    <Command.Item key={c.id} value={`u-${c.id}`} onSelect={() => go(`/staff/claims/${c.id}`)} className={itemCls}>
                      <Receipt className="h-4 w-4 text-muted" aria-hidden /> <span className="num">{c.number}</span>
                      <span className="ml-auto truncate text-[12px] text-muted">{c.clientName}</span>
                    </Command.Item>
                  ))}
                </Command.Group>
              )}
              {canContracts && (contracts.data?.length ?? 0) > 0 && (
                <Command.Group heading={t('staff.palette.contracts')} className="text-[12px] text-muted **:[[cmdk-group-items]]:text-[13px] **:[[cmdk-group-items]]:text-text">
                  {contracts.data!.slice(0, 5).map((c) => (
                    <Command.Item key={c.id} value={`d-${c.id}`} onSelect={() => go(`/staff/contracts/${c.id}`)} className={itemCls}>
                      <FileSignature className="h-4 w-4 text-muted" aria-hidden /> <span className="num">{c.number}</span>
                      {c.externalNumber && <span className="num text-[12px] text-muted">{c.externalNumber}</span>}
                      <span className="ml-auto truncate text-[12px] text-muted">{c.client.name}</span>
                    </Command.Item>
                  ))}
                </Command.Group>
              )}
              {(helpAsk || helpTerms.length + helpArticles.length > 0) && (
                <Command.Group heading={t('help.nav')} className="text-[12px] text-muted **:[[cmdk-group-items]]:text-[13px] **:[[cmdk-group-items]]:text-text">
                  {helpAsk && (
                    <Command.Item
                      value="help-ask"
                      // The question goes in the router state, never in the URL (it may contain personal data).
                      onSelect={() => {
                        onOpenChange(false);
                        navigate('/staff/help', { state: { helpAsk: term } satisfies HelpLocationState });
                      }}
                      className={itemCls}
                      data-testid="palette-help-ask"
                    >
                      <MessageCircleQuestion className="h-4 w-4 shrink-0 text-accent" aria-hidden /> <span className="truncate">{t('help.palette.ask', { text: term })}</span>
                    </Command.Item>
                  )}
                  {helpTerms.map((h) => (
                    <Command.Item key={`ht-${h.term.id}`} value={`ht-${h.term.id}`} onSelect={() => go(helpHref('/staff/help', GLOSSARY_ANCHOR))} className={itemCls}>
                      <Tag className="h-4 w-4 shrink-0 text-muted" aria-hidden /> <span className="truncate">{h.term.term}</span>
                      <span className="ml-auto truncate text-[12px] text-muted">{h.term.definition}</span>
                    </Command.Item>
                  ))}
                  {helpArticles.map((h) => (
                    <Command.Item key={`ha-${h.anchor}-${h.title}`} value={`ha-${h.anchor}-${h.title}`} onSelect={() => go(helpHref('/staff/help', h.articleAnchor, h.anchor))} className={itemCls}>
                      <BookOpen className="h-4 w-4 shrink-0 text-muted" aria-hidden /> <span className="truncate">{h.title}</span>
                      {h.title !== h.articleTitle && <span className="ml-auto truncate text-[12px] text-muted">{h.articleTitle}</span>}
                    </Command.Item>
                  ))}
                </Command.Group>
              )}
              {!claimMode && (
                <Command.Group heading={t('staff.palette.sections')} className="text-[12px] text-muted **:[[cmdk-group-items]]:text-[13px] **:[[cmdk-group-items]]:text-text">
                  {sections
                    .filter((s) => matchesSearch(term, s.label))
                    .map((s) => (
                      <Command.Item key={s.path} value={`s-${s.path}`} onSelect={() => go(s.path)} className={itemCls}>
                        <s.icon className="h-4 w-4 text-muted" aria-hidden /> {s.label}
                        <CornerDownLeft className="ml-auto h-3 w-3 text-muted" aria-hidden />
                      </Command.Item>
                    ))}
                </Command.Group>
              )}
            </Command.List>
          </Command>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
