/** Types for `relay.mjs`, which is plain JS shared with `server.mjs`. */

export const LIVE_PATH: string;
export const TICKET_PATH: string;
export const TICKET_TTL_MS: number;

export function loadDotEnv(dir?: string): void;
export function createTicket(
  secret: string,
  ttlMs?: number,
): { ticket: string; expiresAt: string };
export function verifyTicket(secret: string, ticket: string): boolean;
export function pipeToGemini(
  client: unknown,
  apiKey: string,
  label?: string,
): void;
export function startStandaloneRelay(options?: {
  apiKey?: string;
  port?: number;
  hostname?: string;
  secret?: string;
  token?: string;
  allowedOrigin?: string;
}): { server: unknown; secret: string };
