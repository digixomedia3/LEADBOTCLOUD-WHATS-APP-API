'use client';

import Image from 'next/image';
import { useEffect, useState } from 'react';
import { Ban, Check, CheckCheck, ExternalLink, IndianRupee, MessageCircle, Mic, MousePointerClick, Plus, Reply } from 'lucide-react';
import { estimateCost } from '@/lib/cost';
import { cn } from '@/lib/utils';

type Choice = 'demo' | 'call';
const CHOICES: Record<Choice, { label: string; answer: string }> = {
  demo: { label: 'Book a demo', answer: 'Done, Sneha! Your free demo class is on Monday at 5 PM. The seat fee is ₹4,500, payable any time.' },
  call: { label: 'Call me back', answer: 'Sure, Sneha. Rahul will call you within the hour. The seat fee for the new batch is ₹4,500.' },
};
const CAPTION = [
  '',
  'Tap a button. You are the customer.',
  'Their reply lands in your shared inbox.',
  'Your auto-reply answered in a second.',
  'Cost shown first. Nobody without permission was messaged.',
];
// Steps: 1 offer arrives and waits for a tap · 2 customer replied, business is typing · 3 business answered · 4 recap, then loop.
const HOLD = [0, 6500, 1100, 3800, 6500];

const sample = estimateCost(2100, 'marketing');

function Pop({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('animate-[pop_0.38s_cubic-bezier(0.2,0.8,0.2,1)_both]', className)}>{children}</div>;
}
function Typing() {
  return <Pop><div className="lp-typing w-fit rounded-xl rounded-tl-none bg-white px-3 py-2.5 shadow-sm" aria-label="Typing"><i /><i /><i /></div></Pop>;
}

/**
 * The hero's proof: one WhatsApp conversation the visitor plays as the customer.
 * Sample names and numbers (the same figures as the calculator below). Auto-plays if untouched; static recap for reduced motion.
 */
export function HeroPhone() {
  const [step, setStep] = useState(1);
  const [choice, setChoice] = useState<Choice>('demo');
  const [still, setStill] = useState(false);
  const [cycle, setCycle] = useState(0); // new conversation each loop, so the offer arrives again

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { setStill(true); setStep(4); }
  }, []);
  useEffect(() => {
    if (still) return;
    const t = window.setTimeout(() => { if (step >= 4) { setCycle((c) => c + 1); setStep(1); } else setStep(step + 1); }, HOLD[step]);
    return () => window.clearTimeout(t);
  }, [step, still]);

  const pick = (c: Choice) => { if (step !== 1) return; setChoice(c); setStep(2); };

  return (
    <div className="relative mx-auto w-full max-w-[21.5rem]">
      {/* Phone */}
      <div className="rounded-[2.4rem] border-[7px] border-[#04130f] bg-[#04130f] shadow-[0_40px_80px_-30px_rgba(0,0,0,0.7)]">
        <div className="overflow-hidden rounded-[1.8rem] bg-[#efe7dd]">
          <div className="flex items-center gap-2.5 bg-[#075e54] px-3 py-2.5 text-white">
            <span className="flex size-9 items-center justify-center rounded-full bg-white/20 text-sm font-bold">R</span>
            <div className="min-w-0 leading-tight"><p className="truncate text-sm font-semibold">Rank Up Academy</p><p className="flex items-center gap-1 text-[11px] text-white/75"><Check className="size-3" />Business account</p></div>
          </div>
          <div className="flex h-[25rem] flex-col justify-end sm:h-[27.5rem] gap-1.5 overflow-hidden p-3 text-[13.5px] leading-snug text-[#111b21]" aria-live="polite">
            {/* 1. the offer */}
            <Pop key={`offer-${cycle}`} className="w-full max-w-[18.5rem]">
              <div className="overflow-hidden rounded-xl rounded-tl-none bg-white shadow-sm">
                <Image src="/people/coaching.webp" alt="Illustrative photo for a coaching centre message" width={640} height={640} className="aspect-[16/6.5] w-full object-cover" priority />
                <div className="p-2.5">
                  <p>Hello Sneha, you asked about our NEET batch in March. A new batch starts Monday. Want a free demo class?</p>
                  <p className="mt-1 text-right text-[10.5px] text-black/45">10:30 AM</p>
                </div>
              </div>
              {(Object.keys(CHOICES) as Choice[]).map((c) => (
                <button key={c} type="button" onClick={() => pick(c)} disabled={step !== 1} aria-label={`Reply: ${CHOICES[c].label}`}
                  className={cn('mt-1 flex min-h-11 w-full items-center justify-center gap-1.5 rounded-xl bg-white text-[13px] font-semibold text-[#027eb5] shadow-sm transition active:scale-[0.98]', step === 1 ? 'lp-nudge cursor-pointer hover:bg-[#f4fbff]' : choice === c && step > 1 ? 'bg-[#e7f6ff]' : 'opacity-70')}>
                  <Reply className="size-3.5" />{CHOICES[c].label}
                </button>
              ))}
            </Pop>
            {/* 2. the customer's reply */}
            {step >= 2 ? <Pop className="ml-auto w-fit max-w-[14rem] rounded-xl rounded-tr-none bg-[#d9fdd3] px-2.5 py-1.5 shadow-sm">{CHOICES[choice].label}<span className="ml-2 inline-flex items-center gap-0.5 align-bottom text-[10.5px] text-black/45">10:32 AM<CheckCheck className="size-3.5 text-[#53bdeb]" /></span></Pop> : null}
            {/* 3. the answer */}
            {step === 2 ? <Typing /> : null}
            {step >= 3 ? (
              <Pop className="w-full max-w-[18.5rem]">
                <div className="rounded-xl rounded-tl-none bg-white p-2.5 shadow-sm"><p>{CHOICES[choice].answer}</p><p className="mt-1 text-right text-[10.5px] text-black/45">10:32 AM</p></div>
                <div className="mt-1 flex min-h-11 items-center justify-center gap-1.5 rounded-xl bg-white text-[13px] font-semibold text-[#027eb5] shadow-sm"><ExternalLink className="size-3.5" />Pay now</div>
              </Pop>
            ) : null}
          </div>
          <div className="flex items-center gap-2 bg-[#f0f2f5] px-2.5 py-2 text-[#667781]" aria-hidden="true"><Plus className="size-5" /><span className="flex-1 rounded-full bg-white px-3 py-1.5 text-[13px]">Message</span><Mic className="size-5" /></div>
        </div>
      </div>

      {/* What the owner sees, narrated per step */}
      <p className="mt-4 flex min-h-11 items-center justify-center gap-2 text-center text-sm font-semibold text-white/90" aria-live="polite">
        {step === 1 ? <MousePointerClick className="size-4 shrink-0 text-[var(--lp-wa)]" /> : <Check className="size-4 shrink-0 text-[var(--lp-wa)]" />}{CAPTION[step]}
      </p>
      <p className="text-center text-[11px] text-white/50">Sample conversation, made-up names. Photo is illustrative.</p>

      {/* Proof chips: on phones they sit under the phone; on desktop they orbit it. */}
      <div className="mt-4 flex flex-wrap justify-center gap-2 xl:contents">
        <div className="flex items-center gap-2.5 rounded-2xl bg-white px-3.5 py-2.5 text-[#0b1020] shadow-xl xl:absolute xl:-left-28 xl:top-24 xl:w-52">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[#d9fdd3] text-[#075e54]"><IndianRupee className="size-4.5" /></span>
          <span className="leading-tight"><span className="block font-display text-lg font-extrabold tabular-nums">{sample.totalLabel}</span><span className="block text-[11px] text-[#5b6478]">2,100 people, with GST. Shown before you send.</span></span>
        </div>
        <div className="flex items-center gap-2.5 rounded-2xl bg-white px-3.5 py-2.5 text-[#0b1020] shadow-xl xl:absolute xl:-right-24 xl:bottom-12 xl:w-48">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[#fef3c7] text-[#92400e]"><Ban className="size-4.5" /></span>
          <span className="leading-tight"><span className="block whitespace-nowrap font-display text-lg font-extrabold tabular-nums">900 skipped</span><span className="block text-[11px] text-[#5b6478]">No permission or opted out.</span></span>
        </div>
        <div className={cn('flex items-center gap-2.5 rounded-2xl bg-white px-3.5 py-2.5 text-[#0b1020] shadow-xl transition-all duration-500 xl:absolute xl:-left-24 xl:bottom-28 xl:w-52', step >= 2 ? 'translate-y-0 opacity-100' : 'hidden translate-y-2 opacity-0 xl:flex')}>
          <span className="relative flex size-9 shrink-0 items-center justify-center rounded-xl bg-[#d9fdd3] text-[#075e54]"><MessageCircle className="size-4.5" /><span className="absolute -right-0.5 -top-0.5 size-2.5 rounded-full bg-[#ef4444] ring-2 ring-white" /></span>
          <span className="leading-tight"><span className="block text-sm font-bold">New reply: Sneha</span><span className="block text-[11px] text-[#5b6478]">{CHOICES[choice].label}. Assigned to Rahul.</span></span>
        </div>
      </div>
    </div>
  );
}
