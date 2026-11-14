import type { Category, TemplateDraft } from './template-lint';

/**
 * Ready-made templates. Every entry must pass lintTemplate with no blocking issue (enforced by test), so "Use this"
 * never hands someone a draft that cannot be submitted. Wording is plain, specific and has an opt-out line on promotions.
 * Nothing here is pre-approved: Meta still reviews each one when it is submitted.
 */
export type LibraryGroup = 'Sales' | 'Orders and payments' | 'Appointments' | 'Leads and follow-up' | 'Security';
export interface LibraryItem {
  id: string;
  group: LibraryGroup;
  title: string;
  when: string;
  draft: Omit<TemplateDraft, 'samples'> & { language: 'en' | 'hi'; samples: string[] };
}

const STOP = 'Reply STOP to opt out';
const mk = (id: string, group: LibraryGroup, title: string, when: string, category: Category, body: string, samples: string[], extra: Partial<TemplateDraft> & { language?: 'en' | 'hi' } = {}): LibraryItem => ({
  id, group, title, when,
  draft: { name: id, category, body, samples, buttons: [], language: 'en', ...extra },
});

export const TEMPLATE_LIBRARY: LibraryItem[] = [
  mk('festival_offer', 'Sales', 'Festival offer', 'A time-limited price or gift for a festival or sale.', 'marketing',
    'Hi {{1}}, our {{2}} offer is on till {{3}}. Reply YES and we will send you the details.', ['Asha', 'Diwali', '5 Nov'], { headerText: 'Special offer', footer: STOP, buttons: [{ type: 'quick_reply', text: 'Yes, tell me more' }] }),
  mk('new_arrival', 'Sales', 'New arrival', 'Tell past customers about something new in stock.', 'marketing',
    'Hi {{1}}, we have just got new {{2}} in stock. Tap below to see the collection.', ['Ravi', 'cotton kurtas'], { footer: STOP, buttons: [{ type: 'url', text: 'See collection', value: 'https://example.com/new' }] }),
  mk('back_in_stock', 'Sales', 'Back in stock', 'The thing they asked about is available again.', 'marketing',
    'Hi {{1}}, good news. {{2}} is back in stock. Reply BUY and we will keep one aside for you.', ['Meena', 'The steel water bottle'], { footer: STOP }),
  mk('renewal_reminder', 'Sales', 'Renewal reminder', 'Before a plan, subscription or membership ends.', 'marketing',
    'Hi {{1}}, your {{2}} ends on {{3}}. Renew today to continue without a break.', ['Asha', 'Gold plan', '30 Nov'], { footer: STOP, buttons: [{ type: 'url', text: 'Renew now', value: 'https://example.com/renew' }] }),
  mk('abandoned_cart', 'Sales', 'Items left in cart', 'Nudge someone who left before paying.', 'marketing',
    'Hi {{1}}, you left {{2}} in your cart. It is still saved for you. Complete your order here whenever you are ready.', ['Ravi', 'a brass diya set'], { footer: STOP, buttons: [{ type: 'url', text: 'Complete order', value: 'https://example.com/cart' }] }),
  mk('order_confirmed', 'Orders and payments', 'Order confirmed', 'Right after someone places an order.', 'utility',
    'Hi {{1}}, we have received your order {{2}}. We will message you again when it is shipped.', ['Asha', '#1042']),
  mk('order_shipped', 'Orders and payments', 'Order shipped', 'When the parcel leaves with the courier.', 'utility',
    'Hi {{1}}, your order {{2}} has been shipped. You can track it with {{3}} tracking number {{4}}.', ['Ravi', '#1042', 'Delhivery', 'DL123456'], { buttons: [{ type: 'url', text: 'Track order', value: 'https://example.com/track/{{1}}' }] }),
  mk('payment_received', 'Orders and payments', 'Payment received', 'Confirm a payment the customer just made.', 'utility',
    'Hi {{1}}, we received your payment of Rs {{2}} for {{3}}. Thank you.', ['Meena', '499', 'order #1042']),
  mk('payment_due', 'Orders and payments', 'Payment due', 'A bill or instalment that is coming up.', 'utility',
    'Hi {{1}}, a payment of Rs {{2}} for {{3}} is due on {{4}}. You can pay using the button below.', ['Asha', '1,200', 'your fee', '10 Nov'], { buttons: [{ type: 'url', text: 'Pay now', value: 'https://example.com/pay' }] }),
  mk('cod_confirm', 'Orders and payments', 'Confirm cash on delivery', 'Cut fake COD orders by asking first.', 'utility',
    'Hi {{1}}, please confirm your cash on delivery order {{2}} of Rs {{3}}. We will ship it as soon as you confirm.', ['Ravi', '#1042', '799'], { buttons: [{ type: 'quick_reply', text: 'Confirm order' }, { type: 'quick_reply', text: 'Cancel order' }] }),
  mk('appointment_reminder', 'Appointments', 'Appointment reminder', 'A day before a booked visit or class.', 'utility',
    'Hi {{1}}, this is a reminder of your appointment with {{2}} on {{3}} at {{4}}. Reply YES to confirm.', ['Asha', 'Dr Sharma', '12 Nov', '5:30 pm'], { buttons: [{ type: 'quick_reply', text: 'Yes, confirm' }, { type: 'quick_reply', text: 'Reschedule' }] }),
  mk('booking_confirmed', 'Appointments', 'Booking confirmed', 'When a slot or table is booked.', 'utility',
    'Hi {{1}}, your booking for {{2}} on {{3}} is confirmed. We look forward to seeing you.', ['Ravi', 'a table for 4', '14 Nov at 8 pm']),
  mk('lead_welcome', 'Leads and follow-up', 'Thanks for your enquiry', 'First reply to someone who filled in your form. Only send it to people who agreed to hear from you.', 'utility',
    'Hi {{1}}, thank you for your enquiry about {{2}}. Our team will message you shortly with the details.', ['Asha', 'wedding hampers']),
  mk('lead_follow_up', 'Leads and follow-up', 'Follow-up after enquiry', 'A gentle nudge a day or two later.', 'marketing',
    'Hi {{1}}, we spoke about {{2}} earlier. Would you like us to share the price and a few options? Reply YES and we will send them.', ['Ravi', 'bulk gift boxes'], { footer: STOP, buttons: [{ type: 'quick_reply', text: 'Yes, share options' }, { type: 'quick_reply', text: 'Stop messages' }] }),
  mk('feedback_request', 'Leads and follow-up', 'Ask for feedback', 'A few days after delivery or a visit.', 'marketing',
    'Hi {{1}}, thank you for choosing us. How was your experience with {{2}}? Your feedback helps us improve.', ['Meena', 'order #1042'], { footer: STOP, buttons: [{ type: 'url', text: 'Give feedback', value: 'https://example.com/feedback' }] }),
  mk('otp_login', 'Security', 'Login code (OTP)', 'One-time password for sign-in or verification.', 'authentication',
    'Your verification code is {{1}}. For your security, do not share this code with anyone.', ['482913'], { buttons: [{ type: 'copy_code', text: 'Copy code' }] }),
  mk('hindi_festival_offer', 'Sales', 'Festival offer (Hindi)', 'Same idea as the festival offer, in Hindi.', 'marketing',
    'नमस्ते {{1}}, हमारा {{2}} ऑफर {{3}} तक चल रहा है। विवरण पाने के लिए YES लिखकर भेजें।', ['आशा', 'दिवाली', '5 नवंबर'], { language: 'hi', footer: 'बंद करने के लिए STOP लिखें', buttons: [{ type: 'quick_reply', text: 'हाँ, बताइए' }] }),
];

export const LIBRARY_GROUPS: LibraryGroup[] = ['Sales', 'Orders and payments', 'Appointments', 'Leads and follow-up', 'Security'];

/** A name that does not collide with the workspace's existing templates: festival_offer, festival_offer_2, ... */
export function uniqueTemplateName(base: string, taken: Iterable<string>): string {
  const t = new Set(taken);
  if (!t.has(base)) return base;
  for (let i = 2; i < 1000; i++) if (!t.has(`${base}_${i}`)) return `${base}_${i}`;
  return `${base}_${Date.now()}`;
}
