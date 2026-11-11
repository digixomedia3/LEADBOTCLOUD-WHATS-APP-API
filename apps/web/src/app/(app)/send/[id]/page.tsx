import { notFound } from 'next/navigation';
import { campaigns } from '@/lib/demo-data';
import { CampaignDetail } from '@/components/send/campaign-detail';

export function generateStaticParams() {
  return campaigns.map((c) => ({ id: c.id }));
}

export default async function CampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = campaigns.find((x) => x.id === id);
  if (!c) notFound();
  return <CampaignDetail c={c} />;
}
