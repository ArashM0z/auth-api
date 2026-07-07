import type { FastifyBaseLogger } from 'fastify';

/**
 * Security event trail (SOC 2-style evidence). Each auth-relevant event is
 * logged as structured JSON with `audit: true`, a stable event name, and the
 * request id. Never a password or hash. Ship them to your log pipeline and
 * you have the record of who did what and when.
 */
export type AuditEvent =
  | 'user.created'
  | 'user.create_conflict'
  | 'user.password_rehashed'
  | 'auth.success'
  | 'auth.failure'
  | 'auth.rate_limited';

export interface AuditFields {
  readonly username?: string;
  readonly ip?: string;
}

export function audit(log: FastifyBaseLogger, event: AuditEvent, fields: AuditFields): void {
  log.info({ audit: true, event, ...fields }, `audit: ${event}`);
}
