import { t } from '@/i18n';
import { ChevronDown, X } from 'lucide-react';
import { cn } from '@/shared/lib/cn';
import { Menu, MenuCheckbox, MenuContent, MenuTrigger } from './dropdown';

export interface FilterChipProps {
  label: string;
  options: { value: string; label: string }[];
  selected: string[];
  onChange: (values: string[]) => void;
}

/** Filter as a tag: «Статус: Активен, Продление ×». */
export function FilterChip({ label, options, selected, onChange }: FilterChipProps) {
  const active = selected.length > 0;
  const summary = options
    .filter((o) => selected.includes(o.value))
    .map((o) => o.label)
    .join(', ');
  return (
    <div className={cn('inline-flex h-7 items-center rounded-btn border text-[12px]', active ? 'border-accent/40 bg-accent-soft text-accent-text' : 'border-dashed border-border text-muted')}>
      <Menu>
        <MenuTrigger asChild>
          <button type="button" className="inline-flex h-full items-center gap-1 px-2">
            <span className="font-medium">{label}</span>
            {active && <span className="max-w-[160px] truncate">: {summary}</span>}
            {!active && <ChevronDown className="h-3 w-3" aria-hidden />}
          </button>
        </MenuTrigger>
        <MenuContent align="start">
          {options.map((o) => (
            <MenuCheckbox
              key={o.value}
              checked={selected.includes(o.value)}
              onCheckedChange={(v) => onChange(v ? [...selected, o.value] : selected.filter((s) => s !== o.value))}
            >
              {o.label}
            </MenuCheckbox>
          ))}
        </MenuContent>
      </Menu>
      {active && (
        <button type="button" aria-label={t('shell.filter.reset', { label })} onClick={() => onChange([])} className="px-1.5">
          <X className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}
