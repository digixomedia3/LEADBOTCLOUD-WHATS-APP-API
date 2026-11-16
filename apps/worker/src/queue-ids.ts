/**
 * Job ids for the send queue. BullMQ refuses a custom id that contains ":", so every shape uses "_".
 * A plain message has exactly one job (id = message id) so it can never be queued twice. A message that has to come back later
 * (a retry, a speed turn, quiet hours) gets an id that carries the reason and time, because its earlier job already finished.
 */
export const retryJobId = (messageId: string, attempt: number) => `${messageId}_r${attempt}`;
export const deferredJobId = (messageId: string, untilMs: number) => `${messageId}_t${untilMs}`;
export const dueJobId = (messageId: string, nowMs: number) => `${messageId}_due${Math.floor(nowMs / 60_000)}`;
