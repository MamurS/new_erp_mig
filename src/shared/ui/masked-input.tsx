import { forwardRef, type InputHTMLAttributes } from 'react';
import { maskDate, maskMoney, maskPhone, maskPinfl } from '@/shared/lib/masks';
import { Input } from './input';

export type MaskKind = 'phone' | 'pinfl' | 'date' | 'money';

const MASKS: Record<MaskKind, (v: string) => string> = { phone: maskPhone, pinfl: maskPinfl, date: maskDate, money: maskMoney };
const META: Record<MaskKind, { inputMode: 'tel' | 'numeric'; placeholder: string; autoComplete?: string }> = {
  phone: { inputMode: 'tel', placeholder: '+998 __ ___ __ __', autoComplete: 'tel' },
  pinfl: { inputMode: 'numeric', placeholder: '14 цифр' },
  date: { inputMode: 'numeric', placeholder: 'ДД.ММ.ГГГГ' },
  money: { inputMode: 'numeric', placeholder: '0' },
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
