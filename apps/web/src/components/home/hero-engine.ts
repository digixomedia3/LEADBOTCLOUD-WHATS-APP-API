/**
 * The hero's choreography engine: a port of the motion script in Deep's hero draft (Gemini/Neon), kept step-for-step so the
 * timing matches the draft. It drives the DOM rendered by `hero.tsx` imperatively (the component never re-renders), scoped to
 * the hero root, and returns a cleanup function for React.
 *
 * Changes from the draft, all additive: reduced motion shows the finished state with no autoplay; the loop does not advance
 * while the stage is off screen; phone-width connectors (`.m-wire`) light up where the desktop Bézier wires are hidden;
 * theme changes are picked up from the <html> class (next-themes) instead of the draft's own buttons.
 *
 * Every name and rupee figure here is SAMPLE data, labelled as such next to the stage.
 */

/* Tailwind v3 → v4 class mapping used below: v3 `shadow-sm` = v4 `shadow-xs`; v3 had no `shadow-xs` (dropped);
   gradients use `/srgb` interpolation to match v3; important modifier is a trailing `!`. */
export const TAB_ON =
  'scenario-tab flex-1 sm:flex-none whitespace-nowrap px-1.5 sm:px-3.5 py-3 sm:py-2 rounded-xl text-[11.5px] sm:text-xs font-semibold transition-all duration-200 cursor-pointer bg-slate-900 text-white dark:bg-emerald-500 dark:text-slate-950 shadow-xs';
export const TAB_OFF =
  'scenario-tab flex-1 sm:flex-none whitespace-nowrap px-1.5 sm:px-3.5 py-3 sm:py-2 rounded-xl text-[11.5px] sm:text-xs font-semibold transition-all duration-200 cursor-pointer text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white';
export const PILL_BASE =
  'phase-pill inline-flex items-center gap-1 sm:gap-1.5 px-2 sm:px-2.5 py-1 rounded-full text-[11px] sm:text-xs font-semibold whitespace-nowrap transition-all duration-300';
export const PILL_IDLE = 'text-slate-500 dark:text-slate-400 bg-slate-100/80 dark:bg-slate-800/70';
export const PILL_FIRST = 'bg-amber-500/12 text-amber-700 dark:text-amber-300 ring-1 ring-amber-500/30';

type Lead = { name: string; tag: string; value: string; numericValue: number; tagStyle: 'emerald' | 'indigo' };
type Scenario = {
  id: number; name: string; sourceIndex: number; phoneTag: string; customerMsg: string; botReply: string;
  quickReplies: string[]; selectedReplyIndex: number; verifiedBadge: string; leadPool: Lead[]; sparkPoints: string[];
};

export const SCENARIOS: Scenario[] = [
  {
    id: 0, name: 'Lead Qualification', sourceIndex: 0, phoneTag: 'Lead Flow',
    customerMsg: 'Hi! Saw your ad — how much for 25k monthly API messages?',
    botReply: 'Welcome! 👋 What is your primary goal so I can match the right plan?',
    quickReplies: ['Scale Sales Leads', 'Support Automation'], selectedReplyIndex: 0, verifiedBadge: 'Lead Qualified',
    leadPool: [
      { name: 'Aarav Mehta', tag: 'Hot Lead', value: '₹48,000', numericValue: 48000, tagStyle: 'emerald' },
      { name: 'Neha Kapoor', tag: 'Hot Lead', value: '₹62,000', numericValue: 62000, tagStyle: 'emerald' },
      { name: 'Vikram Rao', tag: 'Enterprise', value: '₹95,000', numericValue: 95000, tagStyle: 'indigo' },
    ],
    sparkPoints: [
      'M 2 44 C 26 42, 40 36, 62 34 C 84 32, 98 24, 122 22 C 146 20, 162 12, 184 10 L 204 6',
      'M 2 44 C 26 40, 42 38, 64 31 C 86 25, 102 22, 126 18 C 150 15, 168 10, 188 8 L 204 4',
    ],
  },
  {
    id: 1, name: 'Cart Recovery', sourceIndex: 1, phoneTag: 'Cart AI',
    customerMsg: 'Left items in checkout: Pro Skincare Bundle (₹4,116)',
    botReply: 'Still thinking it over? ✨ Complete your order now & unlock an instant 15% off.',
    quickReplies: ['Apply 15% & Pay ₹3,499', 'Save for Later'], selectedReplyIndex: 0, verifiedBadge: 'Order Recovered',
    leadPool: [
      { name: 'Priya Sharma', tag: 'Recovered', value: '+₹3,499', numericValue: 3499, tagStyle: 'emerald' },
      { name: 'Ananya Sen', tag: 'Paid COD', value: '+₹3,499', numericValue: 3499, tagStyle: 'emerald' },
      { name: 'Kabir Joshi', tag: 'Recovered', value: '+₹4,850', numericValue: 4850, tagStyle: 'emerald' },
    ],
    sparkPoints: [
      'M 2 46 C 28 45, 48 39, 70 35 C 92 31, 110 27, 132 19 C 154 12, 174 11, 190 8 L 204 5',
      'M 2 45 C 24 41, 46 37, 68 32 C 90 27, 114 21, 136 16 C 158 12, 178 8, 192 6 L 204 3',
    ],
  },
  {
    id: 2, name: 'Instant Booking', sourceIndex: 2, phoneTag: 'Calendar AI',
    customerMsg: 'Interested in the VIP Growth Demo from your broadcast!',
    botReply: 'Awesome! 🚀 Pick a live 15-min slot below and I will lock in your calendar invite:',
    quickReplies: ['Tomorrow, 11:00 AM', 'Tomorrow, 4:30 PM'], selectedReplyIndex: 0, verifiedBadge: 'Calendar Confirmed',
    leadPool: [
      { name: 'Rohan Verma', tag: 'Booked', value: '₹24,000', numericValue: 24000, tagStyle: 'indigo' },
      { name: 'Sneha Nair', tag: 'Confirmed', value: '₹36,000', numericValue: 36000, tagStyle: 'indigo' },
      { name: 'Dev Malhotra', tag: 'Booked', value: '₹28,500', numericValue: 28500, tagStyle: 'indigo' },
    ],
    sparkPoints: [
      'M 2 43 C 28 40, 46 36, 68 30 C 90 25, 110 24, 134 17 C 158 11, 174 10, 190 7 L 204 5',
      'M 2 42 C 26 38, 44 33, 66 28 C 88 23, 108 20, 132 15 C 156 10, 174 7, 190 5 L 204 3',
    ],
  },
];

const CYCLE_DURATION = 9600;
const SVG_NS = 'http://www.w3.org/2000/svg';

export function startHeroEngine(root: HTMLElement): () => void {
  const q = <T extends Element = HTMLElement>(sel: string) => root.querySelector(sel) as T;
  const els = {
    html: document.documentElement,
    motionStage: q('#motionStage'),
    pipelineCanvas: q('#pipelineCanvas'),
    baseWiresGroup: q<SVGGElement>('#baseWiresGroup'),
    activeWiresGroup: q<SVGGElement>('#activeWiresGroup'),
    packetsGroup: q<SVGGElement>('#packetsGroup'),
    chatStream: q('#chatStream'),
    phoneScenarioTag: q('#phoneScenarioTag'),
    cloudAiPill: q('#cloudAiPill'),
    aiStateBadge: q('#aiStateBadge'),
    crmCard: q('#crmCard'),
    crmLeadFeed: q('#crmLeadFeed'),
    revenueCard: q('#revenueCard'),
    revenueValue: q('#revenueValue'),
    leadsTodayValue: q('#leadsTodayValue'),
    revenueDeltaContainer: q('#revenueDeltaContainer'),
    sparkLinePath: q<SVGPathElement>('#sparkLinePath'),
    sparkAreaPath: q<SVGPathElement>('#sparkAreaPath'),
    sparkPeakDot: q<SVGCircleElement>('#sparkPeakDot'),
    sparkPeakHalo: q<SVGCircleElement>('#sparkPeakHalo'),
    cycleProgressFill: q('#cycleProgressFill'),
    stageStatusText: q('#stageStatusText'),
    phasePills: [q('#phasePill1'), q('#phasePill2'), q('#phasePill3')],
    sourceCards: [q('#sourceCard0'), q('#sourceCard1'), q('#sourceCard2')],
    sourceSparks: [q('#sourceSpark0'), q('#sourceSpark1'), q('#sourceSpark2')],
    scenarioTabs: Array.from(root.querySelectorAll<HTMLElement>('.scenario-tab')),
    pausePlayBtn: q('#pausePlayBtn'),
    pauseIcon: q('#pauseIcon'),
    playIcon: q('#playIcon'),
    pausePlayLabel: q('#pausePlayLabel'),
    replayBtn: q('#replayBtn'),
    triggerDemoBtn: q('#triggerDemoBtn'),
    mWireIn: q('#mWireIn'),
    mWireOut: q('#mWireOut'),
  };

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let rafId = 0;
  let visible = true;
  const timers = new Set<number>();
  const later = (fn: () => void, ms: number) => {
    const id = window.setTimeout(() => { timers.delete(id); fn(); }, ms);
    timers.add(id);
  };

  type Wire = { path: SVGPathElement; length: number };
  type Packet = { wire: Wire; group: SVGGElement; elapsed: number; duration: number };
  const state = {
    scenarioIndex: 0,
    leadRotation: 0,
    isPaused: false,
    elapsed: 0,
    lastTimestamp: null as number | null,
    totalRevenue: 284500,
    qualifiedToday: 142,
    sparkToggle: 0,
    firedSteps: new Set<string>(),
    wirePaths: {} as Record<string, Wire>,
    activePackets: [] as Packet[],
    crmRecords: [{ name: 'Meera Iyer', tag: 'Hot Lead', value: '₹42,000', time: '2m ago', tagStyle: 'emerald' }] as { name: string; tag: string; value: string; time: string; tagStyle: string }[],
  };

  const formatINR = (num: number) => '₹' + Math.round(num).toLocaleString('en-IN');
  const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  function triggerReflowClass(el: Element | null, className: string) {
    if (!el) return;
    el.classList.remove(className);
    void (el as HTMLElement).offsetWidth;
    el.classList.add(className);
  }

  /* ---- Bézier wires ---- */
  function getPortCenter(portName: string) {
    const containerRect = els.pipelineCanvas.getBoundingClientRect();
    const portEl = els.pipelineCanvas.querySelector<HTMLElement>(`[data-port="${portName}"]`);
    if (!portEl || portEl.offsetParent === null) return null;
    const r = portEl.getBoundingClientRect();
    return { x: r.left + r.width / 2 - containerRect.left, y: r.top + r.height / 2 - containerRect.top };
  }
  function createBezierD(p1: { x: number; y: number }, p2: { x: number; y: number }) {
    const dx = Math.abs(p2.x - p1.x);
    const o = Math.max(dx * 0.48, 28);
    return `M ${p1.x.toFixed(1)} ${p1.y.toFixed(1)} C ${(p1.x + o).toFixed(1)} ${p1.y.toFixed(1)}, ${(p2.x - o).toFixed(1)} ${p2.y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }
  function buildBezierWires() {
    els.baseWiresGroup.innerHTML = '';
    els.activeWiresGroup.innerHTML = '';
    state.wirePaths = {};
    if (!getPortCenter('phone-in') || !getPortCenter('phone-out')) return; // phone width: ports hidden, `.m-wire` takes over
    const connections = [
      { key: 'in-0', from: 'in-0', to: 'phone-in', grad: 'url(#gradIncoming)' },
      { key: 'in-1', from: 'in-1', to: 'phone-in', grad: 'url(#gradIncoming)' },
      { key: 'in-2', from: 'in-2', to: 'phone-in', grad: 'url(#gradIncoming)' },
      { key: 'out-0', from: 'phone-out', to: 'out-0', grad: 'url(#gradOutgoing)' },
      { key: 'out-1', from: 'phone-out', to: 'out-1', grad: 'url(#gradOutgoing)' },
    ];
    const isDark = els.html.classList.contains('dark');
    const baseStroke = isDark ? 'rgba(148, 163, 184, 0.22)' : 'rgba(15, 23, 42, 0.13)';
    for (const conn of connections) {
      const p1 = getPortCenter(conn.from);
      const p2 = getPortCenter(conn.to);
      if (!p1 || !p2) continue;
      const d = createBezierD(p1, p2);
      const base = document.createElementNS(SVG_NS, 'path');
      base.setAttribute('d', d); base.setAttribute('fill', 'none'); base.setAttribute('stroke', baseStroke);
      base.setAttribute('stroke-width', '1.65'); base.setAttribute('stroke-dasharray', '4 4'); base.setAttribute('stroke-linecap', 'round');
      els.baseWiresGroup.appendChild(base);
      const active = document.createElementNS(SVG_NS, 'path');
      active.setAttribute('d', d); active.setAttribute('fill', 'none'); active.setAttribute('stroke', conn.grad);
      active.setAttribute('stroke-width', '2.5'); active.setAttribute('stroke-linecap', 'round'); active.setAttribute('opacity', '0');
      els.activeWiresGroup.appendChild(active);
      const len = active.getTotalLength();
      active.style.strokeDasharray = `${len}`;
      active.style.strokeDashoffset = `${len}`;
      state.wirePaths[conn.key] = { path: active, length: len };
    }
  }
  function spawnPacket(wireKey: string, colorHex: string, filterId: string, durationMs = 880) {
    if (reduced) return;
    const wire = state.wirePaths[wireKey];
    if (!wire) return;
    const group = document.createElementNS(SVG_NS, 'g');
    const halo = document.createElementNS(SVG_NS, 'circle');
    halo.setAttribute('r', '7.5'); halo.setAttribute('fill', colorHex); halo.setAttribute('opacity', '0.28'); halo.setAttribute('filter', `url(#${filterId})`);
    const core = document.createElementNS(SVG_NS, 'circle');
    core.setAttribute('r', '3.8'); core.setAttribute('fill', '#FFFFFF'); core.setAttribute('stroke', colorHex); core.setAttribute('stroke-width', '2.2'); core.setAttribute('filter', `url(#${filterId})`);
    group.appendChild(halo); group.appendChild(core);
    els.packetsGroup.appendChild(group);
    wire.path.setAttribute('opacity', '0.92');
    state.activePackets.push({ wire, group, elapsed: 0, duration: durationMs });
  }
  function updatePackets(dt: number) {
    for (let i = state.activePackets.length - 1; i >= 0; i--) {
      const pkt = state.activePackets[i]!;
      pkt.elapsed += dt;
      const rawT = Math.min(pkt.elapsed / pkt.duration, 1);
      const t = easeInOutCubic(rawT);
      const pt = pkt.wire.path.getPointAtLength(t * pkt.wire.length);
      pkt.group.setAttribute('transform', `translate(${pt.x.toFixed(1)}, ${pt.y.toFixed(1)})`);
      pkt.wire.path.style.strokeDashoffset = `${(1 - t) * pkt.wire.length}`;
      if (rawT >= 1) {
        pkt.group.remove();
        pkt.wire.path.setAttribute('opacity', '0');
        pkt.wire.path.style.strokeDashoffset = `${pkt.wire.length}`;
        state.activePackets.splice(i, 1);
      }
    }
  }
  function clearAllPackets() {
    for (const p of state.activePackets) {
      p.group.remove();
      p.wire.path.setAttribute('opacity', '0');
      p.wire.path.style.strokeDashoffset = `${p.wire.length}`;
    }
    state.activePackets = [];
  }
  function mWire(el: HTMLElement | null, on: boolean) {
    if (!el) return;
    el.removeAttribute('data-on');
    if (on && !reduced) { void el.offsetWidth; el.setAttribute('data-on', '1'); }
  }

  /* ---- Renderers ---- */
  const PHASES = [
    { active: 'bg-amber-500/12 text-amber-700 dark:text-amber-300 ring-1 ring-amber-500/35', dot: 'bg-amber-500', status: 'Capturing Incoming Lead...' },
    { active: 'bg-indigo-500/12 text-indigo-700 dark:text-indigo-300 ring-1 ring-indigo-500/35', dot: 'bg-indigo-500', status: 'Cloud AI Qualifying...' },
    { active: 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300 ring-1 ring-emerald-500/35', dot: 'bg-emerald-500', status: 'CRM Synced & Converted' },
  ];
  function setActivePhase(n: number) {
    els.phasePills.forEach((pill, idx) => {
      const cur = idx === n - 1;
      pill.className = `${PILL_BASE} ${cur ? PHASES[idx]!.active : PILL_IDLE}`;
      const dot = pill.querySelector('span');
      if (dot) dot.className = `w-1.5 h-1.5 rounded-full ${cur ? PHASES[idx]!.dot : 'bg-slate-400'}`;
    });
    els.stageStatusText.textContent = PHASES[n - 1]!.status;
  }
  function highlightSourceCard(sourceIdx: number) {
    els.sourceCards.forEach((card, idx) => {
      const spark = els.sourceSparks[idx]!;
      const port = card.querySelector('[data-port]');
      if (idx === sourceIdx) {
        card.classList.add('border-amber-500/60', 'dark:border-amber-400/60', 'ring-2', 'ring-amber-500/20');
        spark.classList.remove('hidden');
        triggerReflowClass(card, 'card-react-amber');
        port?.classList.add('border-amber-500', 'bg-amber-400');
      } else {
        card.classList.remove('border-amber-500/60', 'dark:border-amber-400/60', 'ring-2', 'ring-amber-500/20');
        spark.classList.add('hidden');
        port?.classList.remove('border-amber-500', 'bg-amber-400');
      }
    });
  }
  function setAiPillState(label: string, pulsing: boolean) {
    els.aiStateBadge.textContent = label;
    if (pulsing) {
      els.cloudAiPill.classList.add('ring-2', 'ring-indigo-500/35', 'scale-[1.03]');
      els.aiStateBadge.className = 'px-1.5 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider bg-indigo-600 text-white';
    } else {
      els.cloudAiPill.classList.remove('ring-2', 'ring-indigo-500/35', 'scale-[1.03]');
      els.aiStateBadge.className = 'px-1.5 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider bg-emerald-500/15 text-emerald-700 dark:text-emerald-300';
    }
  }
  const scrollChat = () => { els.chatStream.scrollTop = els.chatStream.scrollHeight; };
  function appendCustomerBubble(text: string) {
    const b = document.createElement('div');
    b.className = 'self-start max-w-[88%] animate-spring-in';
    b.innerHTML = `<div class="px-3 py-2 rounded-2xl rounded-tl-md bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 text-[11px] leading-snug shadow-xs border border-slate-900/[0.06] dark:border-white/[0.07]">${text}</div><div class="text-[9px] text-slate-400 mt-0.5 ml-1">Just now</div>`;
    els.chatStream.appendChild(b); scrollChat();
  }
  function removeTypingIndicator() { els.chatStream.querySelector('#activeTypingBubble')?.remove(); }
  function showTypingIndicator() {
    removeTypingIndicator();
    const t = document.createElement('div');
    t.id = 'activeTypingBubble';
    t.className = 'self-end animate-spring-in';
    t.innerHTML = `<div class="px-3 py-2.5 rounded-2xl rounded-tr-md bg-emerald-500/12 dark:bg-emerald-500/20 border border-emerald-500/20 flex items-center gap-1"><span class="typing-dot w-1.5 h-1.5 rounded-full bg-emerald-600 dark:bg-emerald-400"></span><span class="typing-dot w-1.5 h-1.5 rounded-full bg-emerald-600 dark:bg-emerald-400"></span><span class="typing-dot w-1.5 h-1.5 rounded-full bg-emerald-600 dark:bg-emerald-400"></span></div>`;
    els.chatStream.appendChild(t); scrollChat();
  }
  function appendBotReplyWithButtons(replyText: string, quickReplies: string[]) {
    removeTypingIndicator();
    const w = document.createElement('div');
    w.className = 'self-end max-w-[92%] space-y-1.5 animate-spring-in';
    const buttons = quickReplies
      .map((txt, idx) => `<button type="button" data-qr-index="${idx}" class="qr-btn w-full text-left px-2.5 py-1.5 rounded-xl text-[10.5px] font-semibold cursor-pointer bg-white dark:bg-slate-800 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30 hover:bg-emerald-50 dark:hover:bg-emerald-500/15 transition-all flex items-center justify-between"><span>${txt}</span><svg class="w-3 h-3 opacity-70" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="m9 18 6-6-6-6"></path></svg></button>`)
      .join('');
    w.innerHTML = `<div class="px-3 py-2 rounded-2xl rounded-tr-md bg-linear-to-br/srgb from-emerald-500 to-emerald-600 text-white text-[11px] leading-snug shadow-xs">${replyText}</div><div class="space-y-1">${buttons}</div>`;
    w.querySelectorAll('.qr-btn').forEach((btn) => btn.addEventListener('click', () => { if (!state.firedSteps.has('stepD2')) state.elapsed = 4850; }));
    els.chatStream.appendChild(w); scrollChat();
  }
  function simulateQuickReplyTap(index: number) {
    els.chatStream.querySelector(`.qr-btn[data-qr-index="${index}"]`)?.classList.add('quick-reply-tapped', 'bg-emerald-500!', 'text-white!', 'border-emerald-500!', 'shadow-xs');
  }
  function appendVerifiedBadge(text: string) {
    const b = document.createElement('div');
    b.className = 'self-center pt-1 animate-spring-in';
    b.innerHTML = `<div class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/15 dark:bg-emerald-400/20 border border-emerald-500/35 text-emerald-700 dark:text-emerald-300 text-[11px] font-bold"><svg class="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"><path class="check-stroke" d="M20 6 9 17l-5-5"></path></svg><span>${text}</span></div>`;
    els.chatStream.appendChild(b); scrollChat();
  }
  function renderCrmFeed(animateTop = false) {
    els.crmLeadFeed.innerHTML = state.crmRecords
      .slice(0, 2)
      .map((rec, idx) => {
        const tag = rec.tagStyle === 'indigo' ? 'bg-indigo-500/12 text-indigo-700 dark:text-indigo-300' : 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300';
        const anim = animateTop && idx === 0 ? 'animate-spring-in' : '';
        const hl = idx === 0 ? 'bg-emerald-50/70 dark:bg-emerald-500/[0.08] border-emerald-500/25' : 'bg-slate-50/80 dark:bg-slate-900/50 border-slate-900/[0.05] dark:border-white/[0.06] opacity-75';
        return `<div class="${anim} ${hl} p-2 rounded-xl border flex items-center justify-between gap-2"><div class="min-w-0"><div class="flex items-center gap-1.5"><span class="text-xs font-bold text-slate-900 dark:text-white truncate">${rec.name}</span><span class="px-1.5 py-0.5 rounded-md text-[9px] font-bold ${tag}">${rec.tag}</span></div><div class="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">${rec.time}</div></div><div class="text-xs font-extrabold text-slate-900 dark:text-white shrink-0">${rec.value}</div></div>`;
      })
      .join('');
  }
  function animateCounter(el: HTMLElement, from: number, to: number, fmt: (v: number) => string, duration = 620) {
    if (reduced) { el.textContent = fmt(to); return; }
    const start = performance.now();
    const frame = (now: number) => {
      const t = Math.min((now - start) / duration, 1);
      el.textContent = fmt(from + (to - from) * easeInOutCubic(t));
      if (t < 1) requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }
  function pulseRevenueAndSparkline(lead: Lead, scenario: Scenario) {
    const prevRev = state.totalRevenue, prevLeads = state.qualifiedToday;
    state.totalRevenue += lead.numericValue;
    state.qualifiedToday += 1;
    animateCounter(els.revenueValue, prevRev, state.totalRevenue, formatINR, 700);
    animateCounter(els.leadsTodayValue, prevLeads, state.qualifiedToday, (v) => String(Math.round(v)), 520);
    if (!reduced) {
      const delta = document.createElement('span');
      delta.className = 'animate-delta inline-block px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500 text-white shadow-xs';
      delta.textContent = lead.value.startsWith('+') ? lead.value : '+' + lead.value;
      els.revenueDeltaContainer.innerHTML = '';
      els.revenueDeltaContainer.appendChild(delta);
    }
    state.sparkToggle = (state.sparkToggle + 1) % scenario.sparkPoints.length;
    const d = scenario.sparkPoints[state.sparkToggle]!;
    els.sparkLinePath.setAttribute('d', d);
    els.sparkAreaPath.setAttribute('d', `${d} L 204 52 L 2 52 Z`);
    const len = els.sparkLinePath.getTotalLength();
    els.sparkLinePath.style.transition = 'none';
    els.sparkLinePath.style.strokeDasharray = `${len}`;
    els.sparkLinePath.style.strokeDashoffset = reduced ? '0' : `${len * 0.35}`;
    void els.sparkLinePath.getBoundingClientRect();
    els.sparkLinePath.style.transition = 'stroke-dashoffset 0.85s cubic-bezier(0.22, 1, 0.36, 1)';
    els.sparkLinePath.style.strokeDashoffset = '0';
    const end = els.sparkLinePath.getPointAtLength(len);
    for (const c of [els.sparkPeakDot, els.sparkPeakHalo]) { c.setAttribute('cx', end.x.toFixed(1)); c.setAttribute('cy', end.y.toFixed(1)); }
    if (!reduced) triggerReflowClass(els.revenueCard, 'card-react-emerald');
  }

  /* ---- Timeline ---- */
  function resetCycle(advanceLead = false) {
    state.elapsed = 0;
    state.firedSteps.clear();
    clearAllPackets();
    els.chatStream.innerHTML = '';
    els.cycleProgressFill.style.width = '0%';
    if (advanceLead) state.leadRotation += 1;
    els.phoneScenarioTag.textContent = SCENARIOS[state.scenarioIndex]!.phoneTag;
    setActivePhase(1);
    setAiPillState('Listening', false);
    highlightSourceCard(-1);
    mWire(els.mWireIn, false); mWire(els.mWireOut, false);
  }
  function executeTimelineSteps(elapsed: number) {
    const scenario = SCENARIOS[state.scenarioIndex]!;
    const lead = scenario.leadPool[state.leadRotation % scenario.leadPool.length]!;
    const step = (key: string, at: number, fn: () => void) => { if (elapsed >= at && !state.firedSteps.has(key)) { state.firedSteps.add(key); fn(); } };
    step('stepA', 120, () => { setActivePhase(1); highlightSourceCard(scenario.sourceIndex); spawnPacket(`in-${scenario.sourceIndex}`, '#F59E0B', 'glowAmber', 920); mWire(els.mWireIn, true); });
    step('stepB', 1150, () => { setActivePhase(2); appendCustomerBubble(scenario.customerMsg); });
    step('stepC', 1950, () => { setAiPillState('Qualifying', true); showTypingIndicator(); });
    step('stepD', 3100, () => appendBotReplyWithButtons(scenario.botReply, scenario.quickReplies));
    step('stepD2', 4550, () => simulateQuickReplyTap(scenario.selectedReplyIndex));
    step('stepE', 5300, () => { setAiPillState('Verified', false); appendVerifiedBadge(scenario.verifiedBadge); });
    step('stepF', 6050, () => {
      setActivePhase(3);
      spawnPacket('out-0', '#10B981', 'glowEmerald', 850);
      mWire(els.mWireOut, true);
      later(() => { if (!state.isPaused && state.firedSteps.has('stepF')) spawnPacket('out-1', '#10B981', 'glowEmerald', 900); }, 120);
    });
    step('stepG', 6950, () => {
      if (state.crmRecords[0]?.time === 'Just now') state.crmRecords[0].time = '1m ago';
      state.crmRecords.unshift({ name: lead.name, tag: lead.tag, value: lead.value, time: 'Just now', tagStyle: lead.tagStyle });
      if (state.crmRecords.length > 4) state.crmRecords.pop();
      renderCrmFeed(!reduced);
      if (!reduced) triggerReflowClass(els.crmCard, 'card-react-emerald');
      pulseRevenueAndSparkline(lead, scenario);
    });
  }
  function tick(ts: number) {
    if (state.lastTimestamp === null) state.lastTimestamp = ts;
    const dt = Math.min(ts - state.lastTimestamp, 64);
    state.lastTimestamp = ts;
    if (!state.isPaused && visible) {
      state.elapsed += dt;
      els.cycleProgressFill.style.width = `${Math.min((state.elapsed / CYCLE_DURATION) * 100, 100).toFixed(1)}%`;
      executeTimelineSteps(state.elapsed);
      updatePackets(dt);
      if (state.elapsed >= CYCLE_DURATION) resetCycle(true);
    }
    rafId = requestAnimationFrame(tick);
  }
  /** Reduced motion: no loop. Show the finished conversation for the chosen scenario. */
  function showEndState() {
    resetCycle(false);
    executeTimelineSteps(CYCLE_DURATION - 1);
    els.cycleProgressFill.style.width = '100%';
  }

  /* ---- Controls ---- */
  function setPaused(paused: boolean) {
    state.isPaused = paused;
    els.motionStage.classList.toggle('stage-paused', paused);
    els.pauseIcon.classList.toggle('hidden', paused);
    els.playIcon.classList.toggle('hidden', !paused);
    els.pausePlayLabel.textContent = paused ? 'Play' : 'Pause';
    els.pausePlayBtn.setAttribute('aria-label', paused ? 'Play animation' : 'Pause animation');
  }
  function selectScenario(index: number, spotlight = false) {
    state.scenarioIndex = index;
    els.scenarioTabs.forEach((tab, idx) => {
      const on = idx === index;
      tab.setAttribute('aria-selected', String(on));
      tab.className = on ? TAB_ON : TAB_OFF;
    });
    if (reduced) { showEndState(); return; }
    if (state.isPaused) setPaused(false);
    if (spotlight) triggerReflowClass(els.motionStage, 'stage-spotlight');
    resetCycle(false);
  }

  const off: (() => void)[] = [];
  const on = (el: EventTarget | null, type: string, fn: EventListener) => { if (!el) return; el.addEventListener(type, fn); off.push(() => el.removeEventListener(type, fn)); };

  els.scenarioTabs.forEach((tab) => on(tab, 'click', () => selectScenario(Number(tab.dataset.scenario))));
  els.sourceCards.forEach((card) => on(card, 'click', () => selectScenario(Number(card.dataset.scenarioTrigger))));
  on(els.pausePlayBtn, 'click', () => {
    if (reduced && state.isPaused) { setPaused(false); resetCycle(false); return; } // explicit Play overrides reduced motion
    setPaused(!state.isPaused);
  });
  on(els.replayBtn, 'click', () => { if (state.isPaused) setPaused(false); resetCycle(false); });
  on(els.triggerDemoBtn, 'click', () => {
    if (state.isPaused) setPaused(false);
    resetCycle(false);
    triggerReflowClass(els.motionStage, 'stage-spotlight');
    if (window.innerWidth < 1024) els.motionStage.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'center' });
  });

  /* Desktop micro-parallax on the outer columns */
  const parallaxEls = Array.from(root.querySelectorAll<HTMLElement>('[data-parallax]'));
  on(els.motionStage, 'mousemove', ((e: MouseEvent) => {
    if (window.innerWidth < 1024 || state.isPaused || reduced) return;
    const r = els.motionStage.getBoundingClientRect();
    const rx = (e.clientX - r.left) / r.width - 0.5;
    const ry = (e.clientY - r.top) / r.height - 0.5;
    for (const el of parallaxEls) {
      const f = parseFloat(el.dataset.parallax || '0') || 0;
      el.style.transform = `translate3d(${(rx * 7 * f).toFixed(1)}px, ${(ry * 5 * f).toFixed(1)}px, 0)`;
    }
  }) as EventListener);
  on(els.motionStage, 'mouseleave', () => { for (const el of parallaxEls) el.style.transform = 'translate3d(0, 0, 0)'; });

  /* Init */
  renderCrmFeed(false);
  buildBezierWires();
  const ro = new ResizeObserver(() => buildBezierWires());
  ro.observe(els.pipelineCanvas);
  on(window, 'resize', () => buildBezierWires());
  const mo = new MutationObserver(() => buildBezierWires()); // theme switch changes the base wire colour
  mo.observe(els.html, { attributes: true, attributeFilter: ['class'] });
  const io = new IntersectionObserver((entries) => { visible = entries.some((e) => e.isIntersecting); state.lastTimestamp = null; }, { threshold: 0.05 });
  io.observe(els.motionStage);

  if (reduced) {
    setPaused(true);
    showEndState();
  } else {
    resetCycle(false);
  }
  rafId = requestAnimationFrame(tick);

  return () => {
    cancelAnimationFrame(rafId);
    timers.forEach((id) => clearTimeout(id));
    off.forEach((f) => f());
    ro.disconnect(); mo.disconnect(); io.disconnect();
    clearAllPackets();
  };
}
