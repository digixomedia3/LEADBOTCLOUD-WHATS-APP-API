import {
  BarChart3,
  FileText,
  LayoutDashboard,
  Megaphone,
  MessageSquare,
  RefreshCw,
  Settings,
  Users,
  Zap,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  href: string;
  label: string;
  Icon: LucideIcon;
  built: boolean;
  /** What this section will do, shown on its page until it is built. */
  blurb: string;
  bullets: string[];
}

export interface NavGroup {
  title: string;
  items: NavItem[];
}

// Order fixed by the owner: Dashboard, Campaigns, Contacts, Chats, Templates.
export const navGroups: NavGroup[] = [
  {
    title: 'Main',
    items: [
      { href: '/dashboard', label: 'Dashboard', Icon: LayoutDashboard, built: true, blurb: '', bullets: [] },
      {
        href: '/campaigns',
        label: 'Send to customers',
        Icon: Megaphone,
        built: true,
        blurb: 'Create, schedule and track WhatsApp campaigns.',
        bullets: [
          'Pick an approved template synced from WhatsApp',
          'Choose groups or upload a CSV as the audience',
          'See cost, daily limit and opt-outs before you send',
          'Send now, schedule, or repeat daily, weekly or monthly',
          'Live report: sent, delivered, read, replied, failed',
        ],
      },
      {
        href: '/contacts',
        label: 'Contacts',
        Icon: Users,
        built: true,
        blurb: 'Every customer, group and import in one place.',
        bullets: [
          'Add one contact or paste many numbers',
          'Upload CSV or Excel with a guided column match',
          'Static and smart groups with a live count',
          'Tags, custom fields and consent history',
        ],
      },
      {
        href: '/chats',
        label: 'Chats',
        Icon: MessageSquare,
        built: true,
        blurb: 'A shared inbox for your whole team.',
        bullets: [
          'WhatsApp-style conversations with delivery ticks',
          '24-hour reply window with a countdown',
          'Send a template when the window is closed',
          'Assign, resolve, notes and quick replies',
        ],
      },
      {
        href: '/templates',
        label: 'Message formats',
        Icon: FileText,
        built: true,
        blurb: 'Official WhatsApp templates, synced and easy to create.',
        bullets: [
          'Synced from your WhatsApp account with live status',
          'Builder with a phone preview and a pre-submit checker',
          'Plain-language reasons when a template is rejected',
          'Ready-made library for offers, renewals and orders',
        ],
      },
    ],
  },
  {
    title: 'Grow',
    items: [
      {
        href: '/automation',
        label: 'Automation',
        Icon: Zap,
        built: true,
        blurb: 'Reply automatically, without losing the human touch.',
        bullets: ['Welcome and away messages', 'Keyword replies in English and Hinglish', 'Always a way to reach a person'],
      },
      {
        href: '/renewals',
        label: 'Renewals',
        Icon: RefreshCw,
        built: true,
        blurb: 'Collect renewals on autopilot.',
        bullets: ['Track every expiry date', 'Reminder sequence with payment links', 'Marked renewed the moment they pay'],
      },
      {
        href: '/analytics',
        label: 'Analytics',
        Icon: BarChart3,
        built: true,
        blurb: 'See what works and what it costs.',
        bullets: ['Compare campaigns', 'Best time to send', 'Cost per message category'],
      },
    ],
  },
  {
    title: 'Account',
    items: [
      {
        href: '/settings',
        label: 'Settings',
        Icon: Settings,
        built: true,
        blurb: 'Kept small on purpose.',
        bullets: ['Connect WhatsApp in a few clicks', 'Business profile', 'Team and roles', 'Plan and billing', 'Notifications and API keys'],
      },
    ],
  },
];

export const allNav: NavItem[] = navGroups.flatMap((g) => g.items);

export function titleFor(path: string): string {
  return allNav.find((n) => path === n.href || path.startsWith(`${n.href}/`))?.label ?? 'LeadBotCloud';
}

/** Phone bottom bar: four fixed tabs, the rest live under More. */
export const mobileTabs = ['/dashboard', '/campaigns', '/chats', '/contacts'] as const;
