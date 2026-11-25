'use client';

import Link from 'next/link';
import { useRef, useState } from 'react';
import { ArrowRight, Check, Dumbbell, GraduationCap, Plane, Scissors, ShoppingBag, Stethoscope } from 'lucide-react';
import { Bubble, PhoneFrame, Reply_ } from '@/components/marketing/bubbles';
import { cn } from '@/lib/utils';

type Biz = {
  id: string; label: string; Icon: typeof Scissors; from: string; img?: string; body: string; buttons: { label: string; kind: 'url' | 'phone' | 'reply' }[]; confirm?: boolean;
  head: string; uses: string[];
};

const BIZ: Biz[] = [
  { id: 'salon', label: 'Salon or boutique', Icon: Scissors, from: 'Your Boutique', img: '/people/salon.webp', body: 'Hi Ritika, our festive collection is here. This weekend only, 20% off for returning customers.', buttons: [{ label: 'Shop now', kind: 'url' }, { label: 'Talk to us', kind: 'reply' }],
    head: 'Fill the slow days with people who already love you', uses: ['Festive offers to past clients', 'Free-slot announcements for this week', 'Birthday and anniversary greetings with an offer'] },
  { id: 'coaching', label: 'Coaching or classes', Icon: GraduationCap, from: 'Your Institute', img: '/people/coaching.webp', body: 'Hello Mr. Sharma, you asked about our NEET batch in March. A new batch starts Monday. Want a free demo class?', buttons: [{ label: 'Book a demo', kind: 'reply' }, { label: 'Call me back', kind: 'reply' }],
    head: 'Follow up every enquiry you never got back to', uses: ['Old enquiries, one tap each to reply', 'New batch and timetable announcements', 'Fee reminders with a payment link'] },
  { id: 'clinic', label: 'Clinic or lab', Icon: Stethoscope, from: 'Your Clinic', body: 'Hello Mrs. Gupta, a reminder for your appointment tomorrow at 5:00 PM.', buttons: [{ label: 'Confirm', kind: 'reply' }, { label: 'Reschedule', kind: 'reply' }], confirm: true,
    head: 'Fewer empty appointment slots', uses: ['Appointment reminders with Confirm or Reschedule', 'Report ready and follow-up visit nudges', 'Check-up due messages for returning patients'] },
  { id: 'store', label: 'Online store', Icon: ShoppingBag, from: 'Your Store', img: '/people/online-store.webp', body: 'Hi Arjun, your order #1042 has shipped and will reach you by Friday.', buttons: [{ label: 'Track order', kind: 'url' }],
    head: 'Keep buyers informed, and bring them back', uses: ['Order shipped and delivered updates', 'New arrivals to past buyers', 'Back-in-stock and offer messages'] },
  { id: 'gym', label: 'Gym or fitness', Icon: Dumbbell, from: 'Your Gym', img: '/people/gym.webp', body: 'Hi Pooja, it has been a while. Here is 15% off your next month, valid this week.', buttons: [{ label: 'Rejoin now', kind: 'url' }, { label: 'Call us', kind: 'phone' }],
    head: 'Win back members who drifted away', uses: ['Come-back offers for lapsed members', 'Renewal due reminders', 'New batch and trainer announcements'] },
  { id: 'travel', label: 'Travel agency', Icon: Plane, from: 'Your Travels', body: 'Hi Neha, fares to Goa dip next month. Your family trip quote is still open. Want us to hold the dates?', buttons: [{ label: 'Hold the dates', kind: 'reply' }, { label: 'Call us', kind: 'phone' }],
    head: 'Re-open quotes people went quiet on', uses: ['Seasonal packages to past travellers', 'Open-quote follow-ups', 'Document and visa reminders'] },
];

/** Pick your business, see the message and what it is for. One phone instead of six, and the visitor sees their own world. */
export function BusinessPicker({ ctaHref, ctaLabel }: { ctaHref: string; ctaLabel: string }) {
  const [i, setI] = useState(0);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const b = BIZ[i]!;
  const onKey = (e: React.KeyboardEvent) => {
    const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!d) return; e.preventDefault(); const n = (i + d + BIZ.length) % BIZ.length; setI(n); refs.current[n]?.focus();
  };
  return (
    <div>
      <div role="tablist" aria-label="Your kind of business" onKeyDown={onKey} className="lp-scroll-x -mx-4 flex gap-2 overflow-x-auto px-4 pb-2 [scrollbar-width:none] lg:mx-0 lg:flex-wrap lg:overflow-visible lg:px-0">
        {BIZ.map((x, n) => (
          <button key={x.id} ref={(el) => { refs.current[n] = el; }} role="tab" id={`biz-${x.id}`} aria-selected={n === i} aria-controls="biz-panel" tabIndex={n === i ? 0 : -1} onClick={() => setI(n)}
            className={cn('inline-flex min-h-11 shrink-0 items-center gap-2 rounded-full border px-4 text-sm font-medium transition-colors', n === i ? 'border-transparent bg-[var(--lp-night)] text-white dark:bg-white dark:text-[#0b1020]' : 'border-line bg-card text-muted hover:text-ink')}>
            <x.Icon className="size-4" />{x.label}
          </button>
        ))}
      </div>
      <div id="biz-panel" role="tabpanel" aria-labelledby={`biz-${b.id}`} className="mt-6 grid items-center gap-8 sm:mt-8 lg:grid-cols-[minmax(0,22rem)_1fr] lg:gap-16">
        <div key={b.id} className="animate-[pop_0.4s_cubic-bezier(0.2,0.8,0.2,1)_both]">
          <PhoneFrame title={b.from}>
            <Bubble from={b.from} image={b.img} imageAlt="Illustrative photo" imageClassName="aspect-[16/8]" buttons={b.buttons}>{b.body}</Bubble>
            {b.confirm ? <Reply_>Confirm</Reply_> : null}
          </PhoneFrame>
        </div>
        <div>
          <h3 className="text-2xl font-semibold leading-tight tracking-[-0.03em] text-balance sm:text-[2rem]">{b.head}</h3>
          <ul className="mt-5 space-y-3 text-base sm:text-lg">{b.uses.map((u) => <li key={u} className="flex gap-3"><Check className="mt-1 size-5 shrink-0 lp-gtext" />{u}</li>)}</ul>
          <p className="mt-5 max-w-md text-sm text-muted">Buttons let people reply, call or open a link right from the chat. Sample message, made-up names. Yours go out under your business name, using templates Meta has approved.</p>
          <Link href={ctaHref} className="lp-btn lp-btn-primary mt-7 h-12 px-6 text-base">{ctaLabel}<ArrowRight className="size-5" /></Link>
        </div>
      </div>
    </div>
  );
}
