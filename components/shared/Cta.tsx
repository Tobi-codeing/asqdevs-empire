'use client';

import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import type { ReactNode } from 'react';

type Variant = 'primary' | 'outline' | 'ghost';
type Size = 'md' | 'lg';

type BaseProps = {
  children: ReactNode;
  variant?: Variant;
  size?: Size;
  arrow?: boolean;
  className?: string;
};

const base =
  'inline-flex items-center justify-center gap-2 font-medium transition-colors duration-300 select-none';

const variants: Record<Variant, string> = {
  primary: 'bg-[#c6ad78] text-[#0a0a0a] hover:bg-[#aa925f]',
  outline:
    'border border-[#2a2a2a] text-[#f5f3f0] hover:border-[#c6ad78] hover:text-[#c6ad78]',
  ghost: 'text-[#f5f3f0]/70 hover:text-[#c6ad78]',
};

const sizes: Record<Size, string> = {
  md: 'px-6 py-3 text-sm',
  lg: 'px-8 py-4 text-base',
};

function classes({ variant = 'primary', size = 'lg', className = '' }: BaseProps) {
  return `${base} ${variants[variant]} ${sizes[size]} ${className}`;
}

export function CtaLink({
  href,
  children,
  variant,
  size,
  arrow,
  className = '',
  external,
}: BaseProps & { href: string; external?: boolean }) {
  if (external) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className={classes({ children, variant, size, className })}
      >
        {children}
        {arrow && <ArrowRight className="h-4 w-4" />}
      </a>
    );
  }
  return (
    <Link href={href} className={classes({ children, variant, size, className })}>
      {children}
      {arrow && <ArrowRight className="h-4 w-4" />}
    </Link>
  );
}
