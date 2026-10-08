import { Link } from 'react-router-dom';
import type { FamilyMemberBrief } from '@mig/contracts';
import { RELATION_LABEL } from '@mig/domain/family';

/**
 * People of an employee's family by name and relation (FAMILY_SPEC: a list of people instead of «семья: N»).
 * Excluded members are not shown; `to` makes each name a link (staff screens).
 */
export function FamilyNames({ family, to }: { family: readonly FamilyMemberBrief[]; to?: (id: string) => string }) {
  const active = family.filter((m) => m.status === 'active');
  if (!active.length) return <span className="text-muted">—</span>;
  return (
    <ul className="flex flex-col gap-0.5" data-testid="family-names">
      {active.map((m) => (
        <li key={m.id}>
          {to ? (
            <Link to={to(m.id)} className="text-accent-text hover:underline">
              {m.fullName}
            </Link>
          ) : (
            m.fullName
          )}{' '}
          <span className="text-[12px] text-muted">· {RELATION_LABEL[m.relation]}</span>
        </li>
      ))}
    </ul>
  );
}
