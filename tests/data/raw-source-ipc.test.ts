import { describe, expect, it, vi } from 'vitest';
import { ipcMain } from 'electron';
import { registerRawSourcesIpc } from '../../src/main/data/ipc/raw-sources-ipc';
import { IpcInputValidationError } from '../../src/shared/contracts/ipc/validate';

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }));

describe('raw source IPC registration', () => {
  it('rejects malformed auto-include settings before reaching the source service', async () => {
    const setAutoInclude = vi.fn().mockResolvedValue({ id: 'source' });
    const getSources = vi.fn().mockReturnValue({ setAutoInclude });
    registerRawSourcesIpc(getSources, vi.fn());
    const handler = vi
      .mocked(ipcMain.handle)
      .mock.calls.find(([name]) => name === 'data.setRawSourceAutoInclude')?.[1];
    if (!handler) throw new Error('Auto-include handler missing');
    const event = {} as Electron.IpcMainInvokeEvent;
    for (const args of [[9, true], ['  ', true], ['source', 'false'], ['source']]) {
      await expect(handler(event, ...args)).rejects.toBeInstanceOf(IpcInputValidationError);
    }
    expect(getSources).not.toHaveBeenCalled();
    for (const flag of [true, false]) {
      await expect(handler(event, 'source', flag)).resolves.toEqual({ id: 'source' });
      expect(setAutoInclude).toHaveBeenCalledWith('source', flag);
    }
  });
});
