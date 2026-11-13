import { randomInt } from 'node:crypto';
import { MetaError, type GraphClient, type PhoneNumber } from './client';
import { encryptSecret } from './crypto';

/**
 * Embedded Signup, server steps 5 to 11 (spec 2.2). The browser only ever sees a one-time `code`; this runs server-side, holds the app
 * secret, and returns everything to store. It writes nothing itself, so it is testable without a database.
 */
export interface SessionInfo { phone_number_id?: string; waba_id?: string; business_id?: string; [k: string]: unknown }

export const REQUIRED_SCOPES = ['whatsapp_business_management', 'whatsapp_business_messaging'] as const;

export type SignupFailure =
  | 'code_exchange_failed' | 'token_invalid' | 'missing_permission' | 'no_waba' | 'subscribe_failed' | 'no_phone_number' | 'register_failed' | 'meta_unavailable';

export class SignupError extends Error {
  constructor(public readonly reason: SignupFailure, public readonly userMessage: string, public readonly metaCode?: number) { super(`${reason}${metaCode ? ` (${metaCode})` : ''}`); }
}

export interface SignupResult {
  businessId: string | null;
  wabaId: string;
  tokenEnc: string;
  scopes: string[];
  phone: { id: string; display: string | null; verifiedName: string | null; quality: string | null; status: string | null; platformType: string | null; accountMode: string | null; isOnBizApp: boolean | null; throughput: string | null; nameStatus: string | null; codeVerification: string | null };
  pinEnc: string | null;
  registered: boolean;
  mmStatus: string | null;
  disableMarketingOnCloudApi: boolean | null;
  /** Things that did not stop the connection but need the owner's attention. */
  warnings: string[];
}

const metaMsg = (e: unknown): { code?: number; transient: boolean } => (e instanceof MetaError ? { code: e.code, transient: e.isTransient } : { transient: true });

/** A random 6-digit two-step-verification PIN (spec step 9). Uses the CSPRNG, never Math.random. */
export const generatePin = () => String(randomInt(0, 1_000_000)).padStart(6, '0');

export async function completeSignup(args: {
  graph: GraphClient; code: string; sessionInfo?: SessionInfo | null; tokenKey: string; pin?: () => string;
}): Promise<SignupResult> {
  const { graph, code, tokenKey } = args;
  const warnings: string[] = [];

  // Step 5: code -> business token. The code lives 30 seconds, so a failure here usually means "try again".
  let token: string;
  try { token = (await graph.exchangeCode(code)).access_token; if (!token) throw new Error('empty'); }
  catch (e) { const m = metaMsg(e); throw new SignupError('code_exchange_failed', m.transient ? 'Meta did not answer in time. Please try connecting again.' : 'The sign-in code expired or was already used. Please try connecting again.', m.code); }

  // Step 6: is it valid, and did the owner grant both permissions? Without them nothing else works.
  let scopes: string[] = [];
  try {
    const d = (await graph.debugToken(token)).data;
    if (!d.is_valid) throw new SignupError('token_invalid', 'Meta did not accept the connection. Please try again.');
    scopes = d.scopes ?? [];
  } catch (e) { if (e instanceof SignupError) throw e; throw new SignupError('meta_unavailable', 'We could not check the connection with Meta. Please try again in a minute.', metaMsg(e).code); }
  const missing = REQUIRED_SCOPES.filter((s) => !scopes.includes(s));
  if (missing.length) throw new SignupError('missing_permission', 'Some permissions were not granted, so WhatsApp can not be used yet. Connect again and allow every permission on the screen.');

  // Which account did they just create or pick? Prefer what the signup popup reported.
  const wabaId = args.sessionInfo?.waba_id ? String(args.sessionInfo.waba_id) : null;
  if (!wabaId) throw new SignupError('no_waba', 'Meta did not tell us which WhatsApp account you set up. Please finish all steps in the Meta window and try again.');
  const businessId = args.sessionInfo?.business_id ? String(args.sessionInfo.business_id) : null;

  // Step 7: webhooks for this tenant's account. 200 / 1349174 mean the permission is missing.
  try { await graph.subscribeApp(wabaId, token); }
  catch (e) { const m = metaMsg(e); throw new SignupError('subscribe_failed', m.code === 200 || m.code === 1349174 ? 'We were not given permission to this WhatsApp account. Connect again and allow every permission.' : 'We could not turn on message updates for your account. Please try again.', m.code); }

  // Step 8: the numbers on the account. Use the one the popup reported, else the only one.
  let numbers: PhoneNumber[] = [];
  try { numbers = (await graph.listPhoneNumbers(wabaId, token)).data ?? []; }
  catch (e) { throw new SignupError('meta_unavailable', 'We could not read your WhatsApp number from Meta. Please try again in a minute.', metaMsg(e).code); }
  const wanted = args.sessionInfo?.phone_number_id ? String(args.sessionInfo.phone_number_id) : null;
  const picked = (wanted ? numbers.find((n) => n.id === wanted) : numbers.length === 1 ? numbers[0] : undefined) ?? null;
  if (!picked) throw new SignupError('no_phone_number', numbers.length > 1 ? 'More than one number is on this account. Reconnect and choose one in the Meta window.' : 'No phone number was added in the Meta window. Please connect again and add a number.');

  // Step 9: register for the Cloud API with a random 2FA PIN. Numbers moved from the WhatsApp Business app skip this.
  let pinEnc: string | null = null;
  let registered = false;
  if (picked.is_on_biz_app) { registered = true; warnings.push('This number is also used in the WhatsApp Business app, so both keep working.'); }
  else if (String(picked.status ?? '').toUpperCase() === 'CONNECTED' && picked.platform_type === 'CLOUD_API') { registered = true; }
  else {
    const pin = (args.pin ?? generatePin)();
    try { await graph.registerNumber(picked.id, pin, token); registered = true; pinEnc = encryptSecret(pin, tokenKey); }
    catch (e) {
      const m = metaMsg(e);
      if (m.code === 133016) throw new SignupError('register_failed', 'Meta blocks registering this number again for 72 hours because it was tried too many times. Try again in 3 days.', 133016);
      warnings.push('The number is added but is not switched on for sending yet. We will retry; if it stays like this, reconnect.');
    }
  }

  // Step 11: is the Marketing Messages API ready? Not fatal either way; promotional sends fall back to the normal route.
  let mmStatus: string | null = null, disableMarketing: boolean | null = null;
  try { const w = await graph.wabaStatus(wabaId, token); mmStatus = w.marketing_messages_lite_api_status ?? null; disableMarketing = w.disable_marketing_messages_on_cloud_api ?? null; }
  catch { warnings.push('We could not check promotional-message readiness yet. We will check again.'); }

  return {
    businessId, wabaId, tokenEnc: encryptSecret(token, tokenKey), scopes,
    phone: { id: picked.id, display: picked.display_phone_number ?? null, verifiedName: picked.verified_name ?? null, quality: picked.quality_rating ?? null, status: picked.status ?? null, platformType: picked.platform_type ?? null, accountMode: picked.account_mode ?? null, isOnBizApp: picked.is_on_biz_app ?? null, throughput: picked.throughput?.level ?? null, nameStatus: picked.name_status ?? null, codeVerification: picked.code_verification_status ?? null },
    pinEnc, registered, mmStatus, disableMarketingOnCloudApi: disableMarketing, warnings,
  };
}
