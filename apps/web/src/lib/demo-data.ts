/**
 * DEMO DATA for the UI prototype only. Every name, number and amount here is made up
 * (phones use the reserved +91 00000 xxxxx style). Replaced by real queries per module.
 */
export type Tick = 'sent' | 'delivered' | 'read' | 'failed';

export interface Msg {
  id: string;
  dir: 'in' | 'out';
  text: string;
  time: string;
  tick?: Tick;
  error?: string;
  note?: boolean;
}

export interface Chat {
  id: string;
  name: string;
  phone: string;
  last: string;
  time: string;
  unread: number;
  assignee: string | null;
  windowHoursLeft: number; // 0 = closed
  tags: string[];
  messages: Msg[];
}

export const chats: Chat[] = [
  {
    id: 'c1', name: 'Asha Verma', phone: '+91 00000 11101', last: 'Yes please send the payment link', time: '10:42', unread: 2, assignee: 'You', windowHoursLeft: 21, tags: ['Premium', 'Renewal due'],
    messages: [
      { id: 'm1', dir: 'out', text: 'Hi Asha, your Premium plan ends on 14 Nov. Want to renew?', time: '10:30', tick: 'read' },
      { id: 'm2', dir: 'in', text: 'Yes please send the payment link', time: '10:41' },
      { id: 'm3', dir: 'in', text: 'Same price as last time?', time: '10:42' },
    ],
  },
  {
    id: 'c2', name: 'Rohit Singh', phone: '+91 00000 11102', last: 'Thanks, got it', time: '09:15', unread: 0, assignee: 'Priya', windowHoursLeft: 14, tags: ['New'],
    messages: [
      { id: 'm1', dir: 'in', text: 'Do you have the yearly plan?', time: '09:10' },
      { id: 'm2', dir: 'out', text: 'Yes! Yearly is 2 months free. Sending details now.', time: '09:12', tick: 'read' },
      { id: 'm3', dir: 'in', text: 'Thanks, got it', time: '09:15' },
    ],
  },
  {
    id: 'c3', name: 'Neha Gupta', phone: '+91 00000 11103', last: 'Message not delivered', time: 'Yesterday', unread: 0, assignee: null, windowHoursLeft: 0, tags: ['Overdue'],
    messages: [
      { id: 'm1', dir: 'out', text: 'Hi Neha, your plan expired 2 days ago. Renew today to keep access.', time: 'Yesterday', tick: 'failed', error: 'WhatsApp limited offers to this customer today. We will try again after 24 hours.' },
    ],
  },
  {
    id: 'c4', name: 'Imran Khan', phone: '+91 00000 11104', last: 'Can I pay by UPI?', time: 'Yesterday', unread: 1, assignee: null, windowHoursLeft: 3, tags: [],
    messages: [
      { id: 'm1', dir: 'in', text: 'Can I pay by UPI?', time: 'Yesterday' },
      { id: 'n1', dir: 'out', text: 'Customer asked about UPI. Check Razorpay link settings.', time: 'Yesterday', note: true },
    ],
  },
  {
    id: 'c5', name: 'Kavita Rao', phone: '+91 00000 11105', last: 'STOP', time: 'Mon', unread: 0, assignee: 'Priya', windowHoursLeft: 0, tags: ['Stopped messages'],
    messages: [
      { id: 'm1', dir: 'in', text: 'STOP', time: 'Mon' },
      { id: 'm2', dir: 'out', text: 'Okay, you will not get offers from us. Reply START to get them again.', time: 'Mon', tick: 'delivered' },
    ],
  },
];

export interface Customer {
  id: string;
  name: string;
  phone: string;
  tags: string[];
  consent: 'allowed' | 'stopped' | 'unknown';
  source: string;
  lastMessage: string;
  renewal?: string;
}

export const customers: Customer[] = [
  { id: 'c1', name: 'Asha Verma', phone: '+91 00000 11101', tags: ['Premium'], consent: 'allowed', source: 'Website form', lastMessage: 'Today', renewal: 'Due in 3 days' },
  { id: 'c2', name: 'Rohit Singh', phone: '+91 00000 11102', tags: ['New'], consent: 'allowed', source: 'WhatsApp chat', lastMessage: 'Today' },
  { id: 'c3', name: 'Neha Gupta', phone: '+91 00000 11103', tags: ['Overdue'], consent: 'allowed', source: 'Order/invoice', lastMessage: 'Yesterday', renewal: 'Overdue 2 days' },
  { id: 'c4', name: 'Imran Khan', phone: '+91 00000 11104', tags: [], consent: 'allowed', source: 'In shop', lastMessage: 'Yesterday' },
  { id: 'c5', name: 'Kavita Rao', phone: '+91 00000 11105', tags: ['Stopped messages'], consent: 'stopped', source: 'Imported list', lastMessage: 'Mon' },
  { id: 'c6', name: 'Deepak Joshi', phone: '+91 00000 11106', tags: ['Premium'], consent: 'allowed', source: 'Website form', lastMessage: '3 days ago', renewal: 'Renewed' },
  { id: 'c7', name: 'Sana Sheikh', phone: '+91 00000 11107', tags: ['Basic'], consent: 'unknown', source: 'Imported list', lastMessage: '2 weeks ago' },
  { id: 'c8', name: 'Vikram Patel', phone: '+91 00000 11108', tags: ['Premium', 'Yearly'], consent: 'allowed', source: 'Website form', lastMessage: '5 days ago', renewal: 'Due in 12 days' },
];

export type FormatStatus = 'approved' | 'review' | 'rejected' | 'paused';
export interface MsgFormat {
  id: string;
  name: string;
  language: string;
  category: 'marketing' | 'utility' | 'authentication';
  status: FormatStatus;
  quality: 'green' | 'yellow' | 'red' | 'unknown';
  body: string;
  used: number;
  reason?: string;
}

export const formats: MsgFormat[] = [
  { id: 'f1', name: 'renewal_reminder_7d', language: 'en', category: 'marketing', status: 'approved', quality: 'green', body: 'Hi {{1}}, your {{2}} plan ends on {{3}}. Renew now with this link: {{4}}', used: 412 },
  { id: 'f2', name: 'diwali_offer_2026', language: 'en', category: 'marketing', status: 'approved', quality: 'yellow', body: 'Hi {{1}}, our Diwali sale is on! Get 20% off all plans till Sunday. Reply YES to know more.', used: 1240 },
  { id: 'f3', name: 'payment_received', language: 'en', category: 'utility', status: 'approved', quality: 'green', body: 'Payment received. Thank you {{1}}! Your plan is renewed till {{2}}.', used: 188 },
  { id: 'f4', name: 'welcome_new_customer', language: 'hi', category: 'marketing', status: 'review', quality: 'unknown', body: 'Namaste {{1}}, humare saath judne ke liye shukriya. Koi bhi sawal ho to bas reply kijiye.', used: 0 },
  { id: 'f5', name: 'overdue_nudge', language: 'en', category: 'marketing', status: 'rejected', quality: 'unknown', body: '{{1}} pay now or lose access', used: 0, reason: 'Starts with a variable and has too little text. Add words before and after the variable.' },
];

export interface Campaign {
  id: string;
  name: string;
  status: 'running' | 'completed' | 'scheduled' | 'paused' | 'draft';
  when: string;
  total: number;
  sent: number;
  delivered: number;
  read: number;
  replied: number;
  failed: number;
  limited: number;
  costPaise: number;
}

export const campaigns: Campaign[] = [
  { id: 'b1', name: 'Diwali offer', status: 'completed', when: '8 Nov, 6:30 pm', total: 1240, sent: 1240, delivered: 1174, read: 802, replied: 96, failed: 21, limited: 45, costPaise: 107024 },
  { id: 'b2', name: 'Renewal reminder, 7 days', status: 'running', when: 'Today, 10:00 am', total: 220, sent: 140, delivered: 131, read: 74, replied: 18, failed: 2, limited: 3, costPaise: 18988 },
  { id: 'b3', name: 'New plan announcement', status: 'scheduled', when: '15 Nov, 10:30 am', total: 3500, sent: 0, delivered: 0, read: 0, replied: 0, failed: 0, limited: 0, costPaise: 0 },
];

export interface Renewal {
  id: string;
  customer: string;
  plan: string;
  amountPaise: number;
  expiry: string;
  status: 'due_soon' | 'overdue' | 'renewed' | 'cancelled';
  next: string;
}

export const renewals: Renewal[] = [
  { id: 'r1', customer: 'Asha Verma', plan: 'Premium monthly', amountPaise: 49900, expiry: '14 Nov 2026', status: 'due_soon', next: 'Reminder in 1 day' },
  { id: 'r2', customer: 'Vikram Patel', plan: 'Premium yearly', amountPaise: 499900, expiry: '23 Nov 2026', status: 'due_soon', next: 'Reminder in 10 days' },
  { id: 'r3', customer: 'Neha Gupta', plan: 'Basic monthly', amountPaise: 29900, expiry: '9 Nov 2026', status: 'overdue', next: 'Call list: not reachable on WhatsApp' },
  { id: 'r4', customer: 'Deepak Joshi', plan: 'Premium monthly', amountPaise: 49900, expiry: '8 Dec 2026', status: 'renewed', next: 'Paid via link on 8 Nov' },
];

export const planPrices = [
  { id: 'free', name: 'Free', pricePaise: 0, line: '1 number · 1 user · 500 customers' },
  { id: 'starter', name: 'Starter', pricePaise: 49900, line: '2 users · 5,000 customers · unlimited bulk sends' },
  { id: 'growth', name: 'Growth', pricePaise: 129900, line: '5 users · 25,000 customers · renewals · AI writer' },
  { id: 'pro', name: 'Pro', pricePaise: 299900, line: '3 numbers · 15 users · API · chatbot flows' },
] as const;
