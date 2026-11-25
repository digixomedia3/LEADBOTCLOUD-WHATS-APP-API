import { cn } from '@/lib/utils';

/**
 * LeadBotCloud mark: a chat bubble whose three bars rise left to right (a list turning into replies and sales).
 * Drawn on a 32-unit grid so it stays crisp at 24–40px.
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={cn('size-8 shrink-0', className)}>
      <rect width="32" height="32" rx="9" fill="#25D366" />
      <path d="M9 8.5h14a3.5 3.5 0 0 1 3.5 3.5v7.5A3.5 3.5 0 0 1 23 23h-7.2l-4.6 3.6c-.5.4-1.2 0-1.2-.6V23H9a3.5 3.5 0 0 1-3.5-3.5V12A3.5 3.5 0 0 1 9 8.5Z" fill="#06261A" />
      <rect x="10.2" y="16.2" width="2.6" height="3.4" rx="1.3" fill="#25D366" />
      <rect x="14.7" y="13.9" width="2.6" height="5.7" rx="1.3" fill="#25D366" />
      <rect x="19.2" y="11.6" width="2.6" height="8" rx="1.3" fill="#fff" />
    </svg>
  );
}

export function Logo({ className, markClassName }: { className?: string; markClassName?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2.5 text-[17px] font-semibold tracking-[-0.02em]', className)}>
      <LogoMark className={markClassName} />
      LeadBotCloud
    </span>
  );
}
