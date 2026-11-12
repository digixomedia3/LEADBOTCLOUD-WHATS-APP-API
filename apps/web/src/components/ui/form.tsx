import * as React from 'react';
import { cn } from '@/lib/utils';

const field = 'min-h-12 w-full rounded-xl border border-line bg-card px-4 text-base placeholder:text-muted/70 transition-colors focus:border-brand disabled:opacity-60';

export function Input({ className, ...p }: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(field, className)} {...p} />;
}
export function Select({ className, ...p }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn(field, 'pr-8', className)} {...p} />;
}
export function Textarea({ className, ...p }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(field, 'min-h-28 py-3', className)} {...p} />;
}
export function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-semibold">{label}</span>
      {children}
      {error ? <span role="alert" className="text-sm font-medium text-rose">{error}</span> : hint ? <span className="text-xs text-muted">{hint}</span> : null}
    </label>
  );
}
export function FormError({ children }: { children?: React.ReactNode }) {
  if (!children) return null;
  return <p role="alert" className="rounded-xl border border-rose/30 bg-rose/10 px-4 py-3 text-sm font-medium text-rose">{children}</p>;
}
