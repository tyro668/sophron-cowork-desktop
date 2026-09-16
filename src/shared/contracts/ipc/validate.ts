/**
 * Helpers for validating IPC inputs at the main-process boundary.
 * Pure TypeScript — no Electron imports — so they are testable in vitest.
 */
import { ZodError, type ZodType } from 'zod';
import type { ClientEvent } from './index';
import { clientEventSchema } from './schemas';

export interface IpcValidationIssue {
  path: string;
  message: string;
}

export class IpcInputValidationError extends Error {
  readonly channel: string;
  readonly issues: readonly IpcValidationIssue[];

  constructor(channel: string, argIndex: number | null, error: ZodError) {
    const issues = error.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    }));
    const where = argIndex === null ? 'payload' : `arg ${argIndex}`;
    super(
      `Invalid IPC input for '${channel}' (${where}): ` +
        issues.map((i) => `${i.path || '(root)'}: ${i.message}`).join('; ')
    );
    this.name = 'IpcInputValidationError';
    this.channel = channel;
    this.issues = issues;
  }
}

/**
 * Validate positional IPC arguments against per-channel schemas. Arguments
 * beyond `schemas.length` (variadic tails) pass through untouched.
 */
export function validateIpcArgs(
  channel: string,
  schemas: readonly ZodType[],
  args: unknown[]
): unknown[] {
  if (schemas.length === 0) return args;
  const out = args.slice();
  for (let i = 0; i < schemas.length; i++) {
    const result = schemas[i].safeParse(args[i]);
    if (!result.success) {
      throw new IpcInputValidationError(channel, i, result.error);
    }
    out[i] = result.data;
  }
  return out;
}

/** Validate a `client-event` / `client-invoke` envelope. */
export function parseClientEvent(channel: string, data: unknown): ClientEvent {
  const result = clientEventSchema.safeParse(data);
  if (!result.success) {
    throw new IpcInputValidationError(channel, null, result.error);
  }
  return result.data as ClientEvent;
}
