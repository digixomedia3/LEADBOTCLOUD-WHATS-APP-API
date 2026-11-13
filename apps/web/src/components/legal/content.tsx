import Link from 'next/link';
import type { Section } from '@/components/legal/legal-page';
import { company } from '@/lib/company';

/**
 * Plain-language legal text. It describes how the product actually behaves today (each claim is checked against the code), and it is a
 * draft for a lawyer to review before launch. Operator details are never hard-coded: they come from company().
 */
const mail = (e: string | null) => (e ? <a href={`mailto:${e}`}>{e}</a> : <em>the support email shown below</em>);

export function terms(): { title: string; intro: React.ReactNode; sections: Section[] } {
  const c = company();
  return {
    title: 'Terms of Service',
    intro: <p>These terms are an agreement between you (the business using {c.brand}) and {c.legalName}, which runs {c.brand}. By creating a workspace you accept them, together with our <Link href="/acceptable-use">Acceptable Use Policy</Link> and <Link href="/messaging-policy">Messaging and opt-in rules</Link>.</p>,
    sections: [
      { id: 'what', title: '1. What we provide', body: <><p>{c.brand} is software that helps you send WhatsApp messages to your own customers through the official WhatsApp Business Platform, keep a contact list with proof of permission, answer replies, and track renewals.</p><p>You connect your own WhatsApp Business account. {c.brand} is a technology provider. We are not WhatsApp or Meta, and we do not own your WhatsApp account or your phone number.</p></> },
      { id: 'account', title: '2. Your account', body: <ul><li>You must be at least 18 and able to enter a contract for your business.</li><li>Give true details and keep your login private. You are responsible for what people you invite do in your workspace.</li><li>Tell us at once if you think someone else has your login. You can change your password any time, and a reset signs out every device.</li></ul> },
      { id: 'meta', title: '3. WhatsApp and Meta fees', body: <><p>Message charges are set and billed <strong>by Meta directly to you</strong>, on the payment method in your own Meta account. We do not add a markup, and we do not collect these charges.</p><p>The cost shown before a send is an estimate based on the published rate and 18% GST. Your Meta invoice is the final figure. Meta can change its prices, limits, categories and rules at any time, and we can not control that.</p><p>You must also follow Meta&apos;s own terms, including the WhatsApp Business Terms of Service and Messaging Guidelines.</p></> },
      { id: 'permission', title: '4. Permission to message people', body: <><p>You may only send marketing messages to people who agreed to receive them from your business, and you must be able to show how and when. {c.brand} records the source and date you enter, and skips anyone who has opted out. That record helps you. It does not replace your duty to get permission in the first place.</p><p>You alone are responsible for the content of your messages and for who you send them to.</p></> },
      { id: 'acceptable-use', title: '5. What you must not do', body: <><p>The full list is in the <Link href="/acceptable-use">Acceptable Use Policy</Link>. In short: no spam, no messaging people who did not agree, no illegal, deceptive or prohibited businesses, and no reselling or sharing of other people&apos;s accounts or logins. We can pause or close a workspace that breaks these rules, and Meta can restrict your WhatsApp account for the same reasons.</p></> },
      { id: 'plans', title: '6. Plans and payment', body: <><p>Our software plans are billed in Indian rupees plus GST, in advance, for the period you choose. Plans, limits and prices are shown on the pricing page and in your Billing screen. We tell you before a price change takes effect.</p><p>Cancelling, refunds and invoices are explained in the <Link href="/refunds">Refund and Cancellation Policy</Link>.</p></> },
      { id: 'data', title: '7. Your data', body: <><p>Your contacts, messages and files belong to you. For personal data of your customers, you are the data fiduciary and we act as your processor, only on your instructions. How we handle it is described in the <Link href="/privacy">Privacy Policy</Link>.</p><p>You can export your contacts and ask us to delete your workspace at any time (see <Link href="/data-deletion">Data deletion</Link>).</p></> },
      { id: 'availability', title: '8. Availability and changes', body: <p>We work to keep {c.brand} running, but we do not promise it is never interrupted. Sending also depends on WhatsApp and Meta being available. We may improve or change features, and we will give notice of changes that matter to you.</p> },
      { id: 'liability', title: '9. Limits of responsibility', body: <><p>{c.brand} is provided as it is. To the extent the law allows, we are not responsible for: restrictions or fees applied by Meta, messages that are blocked or not delivered, loss of business or profit, or problems caused by content or contacts you provide.</p><p>Our total responsibility to you for any claim is limited to the amount you paid us for the software in the 3 months before the claim. Nothing here limits what the law does not allow us to limit.</p></> },
      { id: 'ending', title: '10. Ending the agreement', body: <p>You can stop using {c.brand} and close your workspace whenever you like. We can suspend or end access if you break these terms or the rules above, or if Meta requires it, and where possible we will tell you why and give you time to export your data first.</p> },
      { id: 'law', title: '11. Law and disputes', body: <p>These terms are governed by the laws of India. Courts in India have jurisdiction. If you have a problem, write to us first at {mail(c.supportEmail)}; most issues can be sorted out quickly.</p> },
      { id: 'contact', title: '12. Contact', body: <p>{c.legalName}{c.address ? `, ${c.address}` : ''}. Email {mail(c.supportEmail)}{c.supportWhatsapp ? <>, WhatsApp {c.supportWhatsapp}</> : null}.</p> },
    ],
  };
}

export function privacy(): { title: string; intro: React.ReactNode; sections: Section[] } {
  const c = company();
  return {
    title: 'Privacy Policy',
    intro: <p>This explains what personal information {c.legalName} handles when you use {c.brand}, why, who else sees it, and what you can ask us to do. It follows India&apos;s Digital Personal Data Protection Act, 2023.</p>,
    sections: [
      { id: 'roles', title: '1. Two roles', body: <><p><strong>For your own account</strong> (your name, email, business details, how you use the product), we decide how it is used. In that case we are the data fiduciary.</p><p><strong>For your customers&apos; information</strong> (the contacts you upload, the messages you exchange), <strong>you are the data fiduciary and we are your processor</strong>. We only handle it to provide the service to you, on your instructions.</p></> },
      { id: 'collect', title: '2. What we collect', body: <ul><li><strong>Account:</strong> name, email, hashed password, business name and category, GSTIN if you add it, plan.</li><li><strong>Your contacts:</strong> phone number, name, groups, tags, whether they gave permission, where and when, and any opt-out.</li><li><strong>Messages:</strong> the messages you send and receive through WhatsApp, with delivery status, and notes your team adds.</li><li><strong>WhatsApp connection:</strong> your WhatsApp Business account and number details. The access token is stored encrypted and is never shown back on any screen.</li><li><strong>Usage and security:</strong> a log of important actions in your workspace (who did what and when), sign-in sessions, and basic technical logs. Full phone numbers and message text are not written to ordinary logs.</li></ul> },
      { id: 'why', title: '3. Why we use it', body: <ul><li>To run the product: sending, receiving and showing your messages, protecting your number, calculating costs.</li><li>To keep accounts safe: sign-in, password reset emails, abuse and fraud checks.</li><li>To support you and to meet legal and billing duties.</li></ul> },
      { id: 'share', title: '4. Who else handles it', body: <><p>We do not sell personal information. We share it only with services needed to run {c.brand}:</p><ul><li><strong>Meta Platforms (WhatsApp):</strong> receives the messages and phone numbers you send to, and tells us about delivery and replies. Meta handles that under its own terms and privacy policy.</li><li><strong>Our hosting and email providers:</strong> store the data and send our emails for us.</li><li><strong>Payment provider (Razorpay):</strong> processes plan payments. We do not store card details.</li></ul><p>We may disclose information if the law requires it.</p></> },
      { id: 'keep', title: '5. How long we keep it', body: <><p>We keep your workspace data while your account is active. When you delete a contact it is erased from our systems, and only anonymous counts remain. When you close your workspace, we delete or anonymise its personal data and your connection token, no later than 90 days after the request, and we confirm when it is done.</p><p>Raw technical records from WhatsApp that may contain personal information are removed after a short retention period. Records we must keep by law, such as invoices, are kept for the period the law requires.</p></> },
      { id: 'security', title: '6. How we protect it', body: <ul><li>Every workspace is separated at database level, so one business can not read another&apos;s data.</li><li>WhatsApp access tokens and PINs are encrypted before they are stored.</li><li>Connections use HTTPS. Webhooks from Meta are verified with a signature before we trust them.</li><li>Roles limit what each team member can do, and important actions are logged.</li></ul> },
      { id: 'rights', title: '7. Your rights', body: <><p>Under the DPDP Act you can ask to access, correct or erase your personal data, withdraw consent, and complain about how it is handled. If you are a business using {c.brand}, you can export and erase contacts yourself in the Contacts screen.</p><p>If you are a <em>customer of one of our users</em> and want your data removed, contact that business first, because they decide how it is used. You can also reply STOP to any of their WhatsApp messages. If you can not reach them, write to us and we will help.</p></> },
      { id: 'grievance', title: '8. Grievance officer', body: <p>{c.grievanceName ? <>Name: <strong>{c.grievanceName}</strong>. </> : null}Contact: {mail(c.grievanceEmail)}. We aim to reply within 7 days and to resolve complaints within the time the law sets.</p> },
      { id: 'changes', title: '9. Changes', body: <p>If we change this policy in a way that matters, we will tell you in the product or by email before it applies. The version and date at the top show when it was last updated.</p> },
    ],
  };
}

export function acceptableUse(): { title: string; intro: React.ReactNode; sections: Section[] } {
  const c = company();
  return {
    title: 'Acceptable Use Policy',
    intro: <p>These rules protect your customers, your WhatsApp number and every other business on {c.brand}. WhatsApp and Meta apply stricter rules to businesses than to people, and breaking them can get your number restricted for everybody using it.</p>,
    sections: [
      { id: 'banned', title: '1. Businesses and content not allowed', body: <><p>You may not use {c.brand} to promote or sell:</p><ul><li>Crypto, trading signals or investment schemes that promise returns</li><li>Gambling, betting, lottery or similar games for money</li><li>Adult content and services</li><li>Multi-level marketing or get-rich-quick schemes</li><li>Payday or predatory lending</li><li>Illegal goods or services, weapons, drugs, tobacco, or anything Meta&apos;s Commerce Policy bans</li><li>Anything deceptive, misleading, hateful, harassing or threatening</li></ul><p>Some categories, such as finance, health and education, need extra care. We may ask you for more information before you can send.</p></> },
      { id: 'accounts', title: '2. Shared and resold accounts', body: <p>Selling, renting or sharing logins, passwords or accounts that belong to someone else (for example streaming, software or learning subscriptions) is not allowed. This includes group buys and &quot;shared&quot; accounts. It breaks the rules of the services involved, and Meta treats it as a policy violation.</p> },
      { id: 'permission', title: '3. Only message people who agreed', body: <ul><li>Every marketing contact must have agreed to hear from your business, in words that name your business.</li><li>You must record where and when they agreed.</li><li>Never buy, scrape or rent phone lists.</li><li>Always honour STOP, and never message someone who has opted out. {c.brand} skips them automatically, and you must not try to get around that.</li></ul> },
      { id: 'sending', title: '4. How you send', body: <ul><li>Do not send the same message again and again to the same person.</li><li>Do not misuse a message format to send content of a different type (for example, offers in a &quot;utility&quot; format).</li><li>Do not send messages designed to avoid Meta&apos;s review or to hide who you are.</li><li>Do not use {c.brand} to attack, overload or probe any system.</li></ul> },
      { id: 'results', title: '5. What happens if rules are broken', body: <p>We may pause sending, ask you to fix something, suspend or close your workspace, and report illegal activity. Meta may also lower your number&apos;s quality rating, limit it, or disable your WhatsApp account. We can not undo Meta&apos;s decisions.</p> },
      { id: 'report', title: '6. Reporting a problem', body: <p>If you got a message you did not ask for, reply STOP to it. To report abuse by a {c.brand} user, write to {mail(c.supportEmail)} with a screenshot.</p> },
    ],
  };
}

export function messagingPolicy(): { title: string; intro: React.ReactNode; sections: Section[] } {
  const c = company();
  return {
    title: 'Messaging and opt-in policy',
    intro: <p>WhatsApp only works when people want your messages. This page explains the permission you need, how to ask for it, and what {c.brand} does to help you stay within the rules.</p>,
    sections: [
      { id: 'optin', title: '1. What counts as permission', body: <><p>Permission (opt-in) must be clear and given by the person themselves. It must:</p><ul><li>Name your business, so they know who they are agreeing to hear from</li><li>Say they agree to receive messages on WhatsApp</li><li>Not be hidden inside long terms or pre-ticked boxes</li></ul><p>Good sources: a form on your website, a tick box at checkout, a customer messaging you first, a QR code or a signed form. Not acceptable: a bought list, or numbers taken from a business card or a group.</p></> },
      { id: 'example', title: '2. A wording you can use', body: <p>&quot;Yes, send me offers and updates from [your business name] on WhatsApp. I can reply STOP at any time.&quot;</p> },
      { id: 'record', title: '3. What we record', body: <p>For each contact you enter, {c.brand} stores the source of permission and the date, and keeps an unchangeable history of every opt-in and opt-out. If Meta or a customer ever asks, you can show it.</p> },
      { id: 'optout', title: '4. Opt-outs', body: <ul><li>If a customer replies STOP, UNSUBSCRIBE or a similar word, or taps a stop button, we mark them as opted out straight away and confirm it to them.</li><li>Opted-out people are skipped in every send, and you can not turn this off.</li><li>If Meta tells us a customer chose to stop marketing messages, we record that too.</li><li>A customer can come back by replying START. We never re-subscribe anyone for them.</li></ul> },
      { id: 'window', title: '5. The 24-hour reply window', body: <p>When a customer messages you, you can reply freely for 24 hours. After that, only an approved message format can start a conversation. {c.brand} shows the remaining time and blocks free-text replies once it closes.</p> },
      { id: 'limits', title: '6. Limits Meta applies', body: <p>Meta limits how many different people you can message each day, and how often one person receives marketing messages. If a message is blocked for that reason, we show it plainly and hold that contact for 24 hours. Quality drops when many people block or report you, so send only what people expect.</p> },
    ],
  };
}

export function refunds(): { title: string; intro: React.ReactNode; sections: Section[] } {
  const c = company();
  return {
    title: 'Refund and Cancellation Policy',
    intro: <p>This covers your {c.brand} software plan. It does <strong>not</strong> cover WhatsApp message charges, which Meta bills to you directly and which we can not refund.</p>,
    sections: [
      { id: 'cancel', title: '1. Cancelling', body: <p>You can cancel your plan yourself in Billing, at any time, without calling us. You keep access until the end of the period you paid for. After that your workspace moves to the free plan, and your data stays unless you ask us to delete it.</p> },
      { id: 'refund', title: '2. Refunds', body: <ul><li>If you cancel or move to a cheaper plan part-way through a paid period, the unused part is refunded in proportion, to the original payment method.</li><li>If you were charged twice or by mistake, we refund the extra amount in full.</li><li>Refunds are processed through our payment provider and normally reach your account within 5 to 7 working days.</li></ul> },
      { id: 'meta', title: '3. Meta charges', body: <p>Message charges, and any card or payment issue on your Meta account, are between you and Meta. Check them in WhatsApp Manager. If a message fails to deliver, Meta decides whether it is charged.</p> },
      { id: 'invoices', title: '4. Invoices and GST', body: <p>You get a GST invoice for every payment, with {c.legalName}{c.gstin ? ` (GSTIN ${c.gstin})` : ''} as the supplier. Add your own GSTIN in Settings so it appears on your invoice.</p> },
      { id: 'help', title: '5. How to ask', body: <p>Write to {mail(c.supportEmail)}{c.supportWhatsapp ? <> or WhatsApp {c.supportWhatsapp}</> : null} with your workspace name and the payment date. We reply within 2 working days.</p> },
    ],
  };
}

export function dataDeletion(): { title: string; intro: React.ReactNode; sections: Section[] } {
  const c = company();
  return {
    title: 'Data deletion',
    intro: <p>You can remove your data from {c.brand} yourself or ask us to do it. This page is also the data deletion instructions page for our Meta app.</p>,
    sections: [
      { id: 'contact', title: '1. Delete one contact', body: <p>In <strong>Contacts</strong>, open the person and choose delete. Their name, number, notes and message history are erased from our systems. We keep only anonymous counts, such as how many messages a campaign sent.</p> },
      { id: 'workspace', title: '2. Delete your whole workspace', body: <><p>Owners can ask us to close a workspace by writing to {mail(c.supportEmail)} from the account email. Before we delete it, you can export your contacts.</p><p>On closing we revoke and erase your WhatsApp connection token, delete or anonymise the workspace&apos;s personal data, and confirm to you by email, no later than 90 days after the request.</p></> },
      { id: 'meta', title: '3. If you came from Facebook or WhatsApp', body: <ul><li>Removing {c.brand} from your Meta Business settings stops our access straight away. We detect that automatically and stop sending.</li><li>To also erase the data we hold, write to {mail(c.supportEmail)} with the business name and the phone number connected.</li></ul> },
      { id: 'customer', title: '4. If you are a customer of a business using LeadBotCloud', body: <p>Reply STOP to stop their messages. To erase your information, ask the business first. If you can not reach them, write to {mail(c.supportEmail)} with your phone number and the business name, and we will pass on or act on the request.</p> },
      { id: 'kept', title: '5. What we may have to keep', body: <p>Invoices and payment records are kept for the period the law requires. Security logs that do not show message content may be kept briefly to prevent abuse.</p> },
    ],
  };
}
