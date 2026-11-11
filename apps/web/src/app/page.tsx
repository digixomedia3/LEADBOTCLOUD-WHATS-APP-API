import Link from 'next/link';
import { i18n } from '@lbc/shared';
import { Button } from '@/components/ui/button';

const t = i18n.en;

// Placeholder landing (spec A4.1 marketing site comes in build-order step 8).
export default function LandingPage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col justify-center gap-6 p-6">
      <h1 className="text-4xl font-bold text-primary">{t.app.name}</h1>
      <p className="text-lg text-muted-foreground">{t.app.tagline}</p>
      <div>
        <Button asChild>
          <Link href="/home">{t.landing.openApp}</Link>
        </Button>
      </div>
      <footer className="mt-8 flex flex-wrap gap-4 text-sm text-muted-foreground">
        <Link href="/terms">{t.legal.terms}</Link>
        <Link href="/privacy">{t.legal.privacy}</Link>
        <Link href="/contact">{t.legal.contact}</Link>
        <span>LeadBotCloud, a product of DigiXoMedia</span>
      </footer>
    </main>
  );
}
