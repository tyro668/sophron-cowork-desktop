// @vitest-environment happy-dom
import { act, renderHook, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import {
  buildComposerContentBlocks,
  useComposerAttachments,
} from '../../src/renderer/hooks/useComposerAttachments';

it('sends a selected screenshot as image bytes and stages the other selected file by path', async () => {
  const png =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aF9kAAAAASUVORK5CYII=';
  const screenshot = new File([Uint8Array.from(atob(png), (c) => c.charCodeAt(0))], 'capture.png', {
    type: 'image/png',
  });
  const notes = new File(['notes'], 'notes.txt', { type: 'text/plain' });
  const getPathForFile = vi.fn(() => '/project/notes.txt');
  vi.stubGlobal('electronAPI', { getPathForFile });
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:preview');
  vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function (
    this: HTMLInputElement
  ) {
    expect(this.type).toBe('file');
    expect(this.multiple).toBe(true);
    Object.defineProperty(this, 'files', { value: [screenshot, notes] });
    this.dispatchEvent(new Event('change'));
  });
  const { result, unmount } = renderHook(() => useComposerAttachments({ isElectron: true }));
  try {
    act(() => result.current.handleFileSelect());
    await waitFor(() => expect(result.current.attachedFiles).toHaveLength(1));
    expect(getPathForFile.mock.calls).toEqual([[notes]]);
    const content = buildComposerContentBlocks({
      prompt: 'Read the image',
      pastedImages: result.current.pastedImages,
      attachedFiles: result.current.attachedFiles,
      attachedCloudTables: [],
    });
    expect(content).toEqual([
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: png } },
      expect.objectContaining({
        type: 'file_attachment',
        filename: 'notes.txt',
        relativePath: '/project/notes.txt',
      }),
      { type: 'text', text: 'Read the image' },
    ]);
  } finally {
    unmount();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  }
});
