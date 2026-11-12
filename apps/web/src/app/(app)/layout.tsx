import { AppShell } from '@/components/shell/app-shell';

// Auth gating arrives with the Better Auth phase. Until then this is a design preview.
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
