import type { CSSProperties } from 'react';

const framing: Record<number, { desktop: string; mobile: string }> = {
  154587: { desktop: '70% 38%', mobile: '58% 35%' },
  1: { desktop: '52% 40%', mobile: '56% 42%' },
  161645: { desktop: '65% 42%', mobile: '54% 35%' },
  5114: { desktop: '62% 48%', mobile: '62% 46%' },
  457: { desktop: '55% 45%', mobile: '42% 40%' },
  153518: { desktop: '64% 44%', mobile: '53% 40%' },
  16498: { desktop: '64% 44%', mobile: '58% 40%' },
  20464: { desktop: '64% 46%', mobile: '48% 40%' },
};

export function heroFraming(id: number): CSSProperties & Record<'--art-position' | '--art-position-mobile', string> {
  const position = framing[id] || { desktop: '65% 45%', mobile: '60% 40%' };
  return { '--art-position': position.desktop, '--art-position-mobile': position.mobile };
}
