# LeadBotCloud: UI and product plan (our own design)

Status: v1, 11 Nov 2026. Replaces the earlier prototype (kept only as git tag `backup/ui-before-revert`).
Goal: a WhatsApp Cloud API marketing panel that is **simpler to use than AiSensy/Wati/Interakt**, fully functional, and visibly better-looking. Spec rules in `AGENTS.md` and `docs/LEADBOTCLOUD_MASTER_SPEC.md` still apply (Meta only through `packages/meta`, tenant isolation, no Meta jargon in plain-language copy, integer paise, IST display).

## 1. Principles
1. **One obvious next action per screen.** Power is one click deeper, never in the way.
2. **Show the money and the risk before the send.** Cost, daily limit, opt-outs, quality, on one review screen.
3. **Official data only.** Templates come from Meta (sync), statuses come from webhooks. Nothing is faked in production screens.
4. **Same experience on phone and desktop.** Phone is a first-class layout, not a shrunken desktop.
5. **Fast and alive.** Skeletons, optimistic updates, subtle motion. Respect `prefers-reduced-motion`.

## 2. Information architecture (collapsible sidebar on desktop, bottom bar + sheet on phone)
Order is fixed by the owner: **Dashboard, Campaigns, Contacts, Chats, Templates**, then Automation, Renewals, Analytics, Settings.

| Section | What it does |
|---|---|
| Dashboard | Greeting, number health, KPIs with sparklines, performance chart, scheduled campaigns, live chats, setup checklist |
| Campaigns | List + calendar view; 5-step create wizard; schedule; live report with Sent/Delivered/Read/Replied/Failed tabs |
| Contacts | Table, filters, bulk actions, **groups**, add manually, **CSV/XLSX import**, paste numbers, export, consent log |
| Chats | Shared inbox: list, conversation, customer panel, 24h window banner, templates in composer, assign, notes |
| Templates | Synced from Meta, status tabs, builder with live phone preview and pre-submit checker, library |
| Automation | Welcome, away, keyword replies, later flows |
| Renewals | Expiry tracking, reminder sequence, payment links, recovered amount |
| Analytics | Campaign comparison, best send time, cost per category |
| Settings | Simplified: WhatsApp connection wizard, business profile, team, billing, notifications, API keys |

## 3. Design language
- **Look:** light and dark. Soft "aurora" gradient (emerald to cyan to indigo) used sparingly for hero and primary actions; glass cards; large rounded corners; bento dashboard grid.
- **Type:** Plus Jakarta Sans (headings), Inter (body). Numbers are tabular and animated on first view.
- **Motion:** staggered fade-up on load, count-up numbers, drawn chart lines, ring fills; all disabled under reduced motion.
- **Shell:** collapsible sidebar (16.5rem to 4.5rem, remembered), top bar with search/command palette (Ctrl or Cmd + K), number status chip, theme toggle, notifications.
- **Phone:** bottom bar (Dashboard, Campaigns, Chats, Contacts, More), More opens a sheet with the rest. Conversations are full screen.
- **Accessibility:** 44 px targets, visible focus, WCAG AA contrast, labelled controls.

## 4. Feature specs for the owner's priority modules
### Contacts
- Add manually (name, phone with country picker defaulting to +91, email, tags, groups, custom fields, consent source + date).
- **CSV/XLSX upload wizard:** upload, auto-detect columns (Hindi/English headers), map, preview with errors highlighted, dedupe by normalised phone, choose group(s), required consent confirmation, result report with downloadable error file.
- **Paste numbers** (one per line) for quick adds.
- **Groups:** static groups (hand-picked or imported) and smart groups (saved filters on tags, fields, last activity, renewal status) with a live count. A contact can be in many groups.
- Table: search, filters, select all matching filter, bulk add to group / tag / export / delete, opted-out badge.
- Contact page: timeline, consent history, groups, custom fields, chat link.
### Campaigns
1. **Template:** pick an approved template synced from Meta, fill variables from contact fields with fallbacks, upload header media, live preview.
2. **Audience:** groups, segments, uploaded CSV, or all opted-in. Live count.
3. **Review and cost:** opted-out removed, no-consent removed, 24h holds, recently messaged, daily limit headroom, number quality, cost estimate in rupees plus GST, spend cap.
4. **Schedule:** send now, send later (IST date/time), **recurring** (daily, weekly, monthly), send window (for example 10 am to 8 pm), throttle speed, auto-split across days when over the limit.
5. **Confirm.** Then a live report: delivery funnel, failures by plain reason, replies, clicks, pause/resume/cancel, resend to unread (draft only).
- Calendar view of everything scheduled; drag to reschedule (later).
### Chats
- WhatsApp-style bubbles with ticks, 24h countdown, "send template" when closed, quick replies, notes, assign/resolve, labels, search, filters (mine, unassigned, unread), realtime.
### Templates
- List synced from Meta with status/quality/category, editing rules respected, rejection explained in plain words, "edit and resubmit", ready-made library, AI writer later (human submits).
### Settings (kept very small)
- Connection wizard (Embedded Signup), business profile, team and roles, billing and plan, notifications, API keys (Pro). Everything else is hidden behind sensible defaults.

## 5. Build phases (each ends with a runnable preview and your review)
| Phase | Scope |
|---|---|
| UI-1 | Shell (collapsible sidebar, top bar, palette, mobile nav, theme), design system, **Dashboard** with sample data |
| UI-2 | **Contacts**: table, add, CSV import wizard, groups |
| UI-3 | **Campaigns**: list, calendar, create wizard with schedule, report |
| UI-4 | **Templates**: list, builder, preview, checker |
| UI-5 | **Chats**: inbox and conversation |
| UI-6 | Settings and connection wizard; Automation; Renewals; Analytics |
| BE-1.. | Auth and workspaces (Better Auth), then schema, Meta client, webhooks, queues, wiring each screen to real data in spec build order |

UI phases use clearly labelled sample data so the design can be judged. Backend phases replace sample data module by module.

## 6. Out of scope for now
Visual chatbot flow builder, A/B tests, Shopify/WooCommerce, Click-to-WhatsApp ads. Logged in `docs/backlog.md`.
