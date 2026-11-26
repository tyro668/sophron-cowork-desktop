/**
 * @module main/ipc-handle
 *
 * Drop-in replacement for `ipcMain.handle` that validates inbound arguments
 * against the zod schemas registered in shared/contracts/ipc/schemas.ts.
 * Validation failures reject the invoke with an IpcInputValidationError that
 * carries the channel name and the failing argument index.
 */
import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import { IPC_INPUT_SCHEMAS, type IpcChannel } from '../shared/contracts/ipc/schemas';
import { validateIpcArgs } from '../shared/contracts/ipc/validate';

type IpcHandler<Args extends unknown[]> = (event: IpcMainInvokeEvent, ...args: Args) => unknown;

export function handleIpc<Args extends unknown[]>(
  channel: IpcChannel,
  handler: IpcHandler<Args>
): void {
  const schemas = IPC_INPUT_SCHEMAS[channel];
  if (!Object.hasOwn(IPC_INPUT_SCHEMAS, channel)) {
    throw new Error(`Missing IPC input schema: ${channel}`);
  }
  ipcMain.handle(channel, async (event, ...args: unknown[]) => {
    const validated = validateIpcArgs(channel, schemas, args);
    return handler(event, ...(validated as Args));
  });
}
