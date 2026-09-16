/**
 * @module main/ipc-handle
 *
 * Drop-in replacement for `ipcMain.handle` that validates inbound arguments
 * against the zod schemas registered in shared/contracts/ipc/schemas.ts.
 * Validation failures reject the invoke with an IpcInputValidationError that
 * carries the channel name and the failing argument index.
 */
import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import { IPC_INPUT_SCHEMAS } from '../shared/contracts/ipc/schemas';
import { validateIpcArgs } from '../shared/contracts/ipc/validate';
import { logWarn } from './utils/logger';

type IpcHandler = (event: IpcMainInvokeEvent, ...args: never[]) => unknown;

const warnedChannels = new Set<string>();

export function handleIpc(channel: string, handler: IpcHandler): void {
  const schemas = IPC_INPUT_SCHEMAS[channel];
  if (!schemas && !warnedChannels.has(channel)) {
    warnedChannels.add(channel);
    logWarn(`[IPC] No input schema registered for channel '${channel}'`);
  }
  ipcMain.handle(channel, async (event, ...args: unknown[]) => {
    const validated = schemas ? validateIpcArgs(channel, schemas, args) : args;
    return (handler as (e: IpcMainInvokeEvent, ...a: unknown[]) => unknown)(event, ...validated);
  });
}
