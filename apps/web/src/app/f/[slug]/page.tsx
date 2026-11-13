import { notFound } from 'next/navigation';
import { sql } from 'drizzle-orm';
import { appDb } from '@/lib/session';
import { PublicForm, type PublicFormConfig } from '@/components/leads/public-form';

export const dynamic = 'force-dynamic';
const SLUG = /^[a-z0-9][a-z0-9-]{5,40}$/;

async function load(slug: string): Promise<PublicFormConfig | null> {
  if (!SLUG.test(slug)) return null;
  const r = (await appDb.execute(sql`select public.public_form(${slug}) as f`)) as unknown as { f: PublicFormConfig | null }[];
  return r[0]?.f ?? null;
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const f = await load((await params).slug);
  // Customers' forms should not be indexed or carry our branding in search results.
  return { title: f ? `${f.title} · ${f.business}` : 'Form', robots: { index: false, follow: false } };
}

/** Public lead form. No login. The only data read is what public_form() returns: title, wording, fields and the business name. */
export default async function FormPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const f = await load(slug);
  if (!f) notFound();
  // Count the view without a tenant context; failure here must never break the page.
  await appDb.execute(sql`select public.count_form_view(${slug})`).catch(() => undefined);
  const action = `${(process.env.WORKER_PUBLIC_URL ?? '').replace(/\/+$/, '')}/forms/${slug}`;
  return <PublicForm config={f} action={action} />;
}
