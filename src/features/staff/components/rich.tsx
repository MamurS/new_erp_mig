import { Fragment, type ReactNode } from 'react';
import { t, type I18nKey } from '@/i18n';

/**
 * A translated sentence whose `{name}` placeholders are React nodes (bold amounts, links), so the
 * sentence stays whole in the dictionary while parts of it keep their markup.
 */
export function Rich({ k, values }: { k: I18nKey; values: Record<string, ReactNode> }) {
  const parts = t(k).split(/\{(\w+)\}/);
  return (
    <>
      {parts.map((p, i) => (i % 2 === 1 ? <Fragment key={i}>{p in values ? values[p] : `{${p}}`}</Fragment> : p))}
    </>
  );
}
