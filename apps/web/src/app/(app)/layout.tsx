import { AppShell } from '@/components/app-shell';

// Auth gating is added in the Better Auth PR; until then this shell is a static preview.
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
