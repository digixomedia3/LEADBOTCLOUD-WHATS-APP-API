import { Bell, Calendar, Camera, Gift, Heart, IndianRupee, MessageCircle, Phone, ShoppingBag, Star, Truck, Users } from 'lucide-react';

const TILE = 340;
const ICONS = [
  { I: MessageCircle, x: 14, y: 18, r: -12, s: 34 }, { I: ShoppingBag, x: 120, y: 60, r: 10, s: 30 }, { I: IndianRupee, x: 232, y: 14, r: 14, s: 32 },
  { I: Bell, x: 40, y: 112, r: 8, s: 28 }, { I: Gift, x: 178, y: 128, r: -10, s: 34 }, { I: Heart, x: 286, y: 100, r: 12, s: 26 },
  { I: Calendar, x: 12, y: 214, r: -6, s: 32 }, { I: Camera, x: 104, y: 236, r: 12, s: 30 }, { I: Phone, x: 214, y: 232, r: -14, s: 30 },
  { I: Star, x: 290, y: 200, r: 8, s: 26 }, { I: Truck, x: 70, y: 296, r: -4, s: 28 }, { I: Users, x: 232, y: 300, r: 6, s: 28 },
] as const;

/** WhatsApp-style chat-wallpaper doodles: the page's own texture. Decorative only (aria-hidden). */
export function Doodle({ id, className = 'text-white/[0.07]' }: { id: string; className?: string }) {
  return (
    <svg aria-hidden="true" className={`pointer-events-none absolute inset-0 -z-10 h-full w-full ${className}`}>
      <defs>
        <pattern id={id} width={TILE} height={TILE} patternUnits="userSpaceOnUse">
          <g fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            {ICONS.map(({ I, x, y, r, s }, i) => (
              <g key={i} transform={`rotate(${r} ${x + s / 2} ${y + s / 2})`}><I x={x} y={y} width={s} height={s} strokeWidth={1.5} /></g>
            ))}
          </g>
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${id})`} />
    </svg>
  );
}
