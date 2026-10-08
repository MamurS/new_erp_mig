import { t } from '@/i18n';
import { forwardRef, type InputHTMLAttributes } from 'react';
import { maskCardNumber, maskDate, maskMoney, maskPhone, maskPinfl } from '@mig/domain/lib/masks';
import { Input } from './input';

export type MaskKind = 'phone' | 'pinfl' | 'date' | 'money' | 'card';

const MASKS: Record<MaskKind, (v: string) => string> = { phone: maskPhone, pinfl: maskPinfl, date: maskDate, money: maskMoney, card: maskCardNumber };
const META: Record<MaskKind, { inputMode: 'tel' | 'numeric'; readonly placeholder: string; autoComplete?: string }> = {
  phone: { inputMode: 'tel', placeholder: '+998 __ ___ __ __', autoComplete: 'tel' },
  pinfl: {
    inputMode: 'numeric',
    get placeholder() {
      return t('shell.mask.pinfl');
    },
  },
  date: {
    inputMode: 'numeric',
    get placeholder() {
      return t('shell.mask.date');
    },
  },
  money: { inputMode: 'numeric', placeholder: '0' },
  card: { inputMode: 'numeric', placeholder: '8600 ____ ____ ____', autoComplete: 'off' },
};

export interface MaskedInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value'> {
  mask: MaskKind;
  value: string;
  onChange: (value: string) => void;
}

export const MaskedInput = forwardRef<HTMLInputElement, MaskedInputProps>(({ mask, value, onChange, ...props }, ref) => {
  const meta = META[mask];
  return (
    <Input
      ref={ref}
      inputMode={meta.inputMode}
      placeholder={meta.placeholder}
      autoComplete={meta.autoComplete ?? 'off'}
      {...props}
      value={value}
      onChange={(e) => onChange(MASKS[mask](e.target.value))}
    />
  );
});
MaskedInput.displayName = 'MaskedInput';
