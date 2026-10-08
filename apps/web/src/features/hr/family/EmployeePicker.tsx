import { useId, useState } from 'react';
import { X } from 'lucide-react';
import { useHrEmployees } from '@/shared/api/queries/hr';
import { useDebounced } from '@/shared/lib/hooks';
import { Input } from '@/shared/ui/input';
import { t } from '@/i18n';

export interface PickedEmployee {
  id: string;
  fullName: string;
}

/**
 * The employee whose family member is added: a search over the company's active employees (server search,
 * the same as on «Сотрудники»), the results as a list of options.
 */
export function EmployeePicker({
  value,
  onChange,
  inputId,
  invalid,
  describedBy,
}: {
  value: PickedEmployee | null;
  onChange: (v: PickedEmployee | null) => void;
  inputId: string;
  invalid?: boolean;
  describedBy?: string;
}) {
  const [query, setQuery] = useState('');
  const q = useDebounced(query.trim(), 250);
  const listId = useId();
  const list = useHrEmployees({ q: q || undefined, page: 1, pageSize: 8 });
  const options = (list.data?.items ?? []).filter((e) => e.status === 'active');

  if (value) {
    return (
      <div className="flex h-12 items-center justify-between gap-2 rounded-btn border border-border bg-surface px-3" data-testid="picked-employee">
        <span className="truncate font-semibold">{value.fullName}</span>
        <button type="button" className="rounded-btn p-2 text-muted hover:bg-rail" aria-label={t('hr.familyAdd.changeEmployee')} onClick={() => onChange(null)}>
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <Input
        id={inputId}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        maxLength={80}
        autoComplete="off"
        placeholder={t('hr.familyAdd.employeeSearch')}
        aria-invalid={invalid}
        aria-describedby={describedBy}
        aria-controls={listId}
        className="h-12"
      />
      <ul id={listId} role="listbox" aria-label={t('hr.familyAdd.employeeOptions')} className="max-h-64 overflow-y-auto rounded-btn border border-border">
        {options.map((e) => (
          <li
            key={e.id}
            role="option"
            aria-selected={false}
            tabIndex={0}
            onClick={() => onChange({ id: e.id, fullName: e.fullName })}
            onKeyDown={(ev) => {
              if (ev.key === 'Enter' || ev.key === ' ') {
                ev.preventDefault();
                onChange({ id: e.id, fullName: e.fullName });
              }
            }}
            className="flex min-h-11 cursor-pointer items-center gap-2 px-3 py-2 hover:bg-rail focus-visible:bg-rail focus-visible:outline-none"
          >
            <span className="min-w-0">
              <span className="block truncate font-medium">{e.fullName}</span>
              {e.position && <span className="block truncate text-[13px] text-muted">{e.position}</span>}
            </span>
          </li>
        ))}
        {!list.isLoading && options.length === 0 && <li className="px-3 py-2 text-muted">{t('hr.familyAdd.noEmployees')}</li>}
      </ul>
    </div>
  );
}
