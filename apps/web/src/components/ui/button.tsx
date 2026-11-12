import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const button = cva(
  'inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-semibold transition-all duration-200 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        primary: 'grad-bg text-white shadow-[0_10px_30px_-12px_rgba(16,185,129,0.7)] hover:brightness-110',
        soft: 'bg-brand/10 text-brand hover:bg-brand/20',
        outline: 'border border-line bg-card hover:border-brand/60 hover:bg-card2',
        ghost: 'hover:bg-ink/5',
        glass: 'glass text-white hover:bg-white/20',
      },
      size: { lg: 'min-h-12 px-7 text-base', md: 'min-h-11 px-5', sm: 'min-h-10 px-3.5', icon: 'size-11' },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof button> {
  asChild?: boolean;
}

export function Button({ className, variant, size, asChild, ...props }: ButtonProps) {
  const Comp = asChild ? Slot : 'button';
  return <Comp className={cn(button({ variant, size }), className)} {...props} />;
}
