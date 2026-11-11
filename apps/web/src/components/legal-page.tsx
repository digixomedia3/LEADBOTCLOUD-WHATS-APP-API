import { i18n } from '@lbc/shared';

export function LegalPage({ title }: { title: string }) {
  return (
    <main className="mx-auto max-w-2xl p-6">
      <h1 className="mb-4 text-3xl font-bold">{title}</h1>
      <p className="text-muted-foreground">{i18n.en.legal.placeholder}</p>
    </main>
  );
}
