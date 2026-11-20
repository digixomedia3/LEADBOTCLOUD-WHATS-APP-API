/** Plain reasons a held-back send could not go ahead. Kept in one place: the worker writes the key, the report screen shows the words. */
export const RELEASE_REASONS: Record<string, string> = {
  template_not_approved: 'The version you chose is no longer approved by WhatsApp. Pick the other version or fix the template.',
  not_connected: 'Your WhatsApp number is not connected. Reconnect it, then send the winner again.',
  reconnect: 'Your WhatsApp connection needs to be reconnected before anything can be sent.',
  account_restricted: 'WhatsApp has restricted your account, so nothing can be sent right now.',
  payment_banner: 'WhatsApp could not charge your payment method. Fix it, then send the winner again.',
  offer_ended: 'The offer in this campaign has ended, so it cannot be sent to more people.',
  offer_time_missing: 'The offer in this campaign has no end time, so it cannot be sent to more people.',
  link_missing: 'The tracked link for this campaign is missing.',
  app_url_temporary: 'This workspace is on a temporary address, so tracked links would stop working. Try again on the permanent address.',
  spend_cap: 'Sending to everyone would go over your spend cap. Raise the cap on the campaign or leave the rest unsent.',
  offer_code_missing: 'The offer code for this campaign is missing.',
};
