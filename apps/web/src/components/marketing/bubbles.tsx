import Image from 'next/image';
import { Check, CheckCheck, ExternalLink, Phone, Reply } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface BubbleButton { label: string; kind: 'url' | 'phone' | 'reply' }
const ICON = { url: ExternalLink, phone: Phone, reply: Reply } as const;

/** A WhatsApp-style message, for showing what a customer receives. Original sample copy, not a real customer. */
export function Bubble({ from, image, children, buttons = [], time = '10:30 AM', className, imageAlt = '', imageClassName = 'aspect-[4/3]' }: {
  from: string; image?: string; imageAlt?: string; imageClassName?: string; children: React.ReactNode; buttons?: BubbleButton[]; time?: string; className?: string;
}) {
  return (
    <div className={cn('w-full max-w-[19rem] text-[13.5px] leading-snug text-[#111b21]', className)}>
      <div className="overflow-hidden rounded-xl rounded-tl-none bg-white shadow-sm">
        {image ? <Image src={image} alt={imageAlt} width={640} height={640} className={cn('w-full object-cover', imageClassName)} /> : null}
        <div className="p-2.5">
          <p className="mb-0.5 text-xs font-bold text-[#027eb5]">{from}</p>
          <div>{children}</div>
          <p className="mt-1 text-right text-[10.5px] text-black/45">{time}</p>
        </div>
      </div>
      {buttons.map((b) => { const I = ICON[b.kind]; return (
        <div key={b.label} className="mt-1 flex items-center justify-center gap-1.5 rounded-xl bg-white py-2.5 text-[13px] font-semibold text-[#027eb5] shadow-sm"><I className="size-3.5" />{b.label}</div>
      ); })}
    </div>
  );
}

export function Reply_({ children, time = '10:32 AM' }: { children: React.ReactNode; time?: string }) {
  return (
    <div className="ml-auto mt-2 w-fit max-w-[14rem] rounded-xl rounded-tr-none bg-[#d9fdd3] px-2.5 py-1.5 text-[13.5px] text-[#111b21] shadow-sm">
      {children}<span className="ml-2 inline-flex items-center gap-0.5 align-bottom text-[10.5px] text-black/45">{time}<CheckCheck className="size-3.5 text-[#53bdeb]" /></span>
    </div>
  );
}

/** Phone-shaped frame with the WhatsApp chat wallpaper behind the bubbles. */
export function PhoneFrame({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('mx-auto w-full max-w-[21.5rem] rounded-[2.2rem] border-[7px] border-[#0d1220] bg-[#0d1220] shadow-2xl', className)}>
      <div className="overflow-hidden rounded-[1.7rem] bg-[#efe7dd]">
        <div className="flex items-center gap-2 bg-[#075e54] px-3 py-2.5 text-white"><span className="flex size-8 items-center justify-center rounded-full bg-white/20 text-xs font-bold">{title.slice(0, 1)}</span><div className="leading-tight"><p className="text-sm font-semibold">{title}</p><p className="flex items-center gap-1 text-[10.5px] text-white/75"><Check className="size-3" />Business account</p></div></div>
        <div className="min-h-[18rem] space-y-1 p-3">{children}</div>
      </div>
    </div>
  );
}

/** Real screenshot of our own panel inside a simple browser frame. */
export function Shot({ src, alt, url, className, priority }: { src: string; alt: string; url: string; className?: string; priority?: boolean }) {
  return (
    <figure className={cn('overflow-hidden rounded-2xl border border-line bg-card shadow-[0_30px_70px_-35px_rgba(10,20,50,0.5)]', className)}>
      <div className="flex items-center gap-1.5 border-b border-line bg-card2 px-3 py-2" aria-hidden="true"><span className="size-2.5 rounded-full bg-rose/70" /><span className="size-2.5 rounded-full bg-amber/70" /><span className="size-2.5 rounded-full bg-brand/70" /><span className="ml-3 truncate rounded-md bg-bg px-3 py-0.5 text-[11px] text-muted">{url}</span></div>
      <Image src={src} alt={alt} width={1280} height={800} priority={priority} className="h-auto w-full" />
    </figure>
  );
}
