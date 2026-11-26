// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { createPortal } from 'react-dom';
import { Titlebar } from '../../src/renderer/components/Titlebar';
import { useTitlebarBrandSlot } from '../../src/renderer/hooks/use-titlebar-brand-slot';
import { desktopClient } from '../../src/renderer/features/desktop/api/desktop-client';
import '../../src/renderer/i18n/config';

function Brand() {
  const slot = useTitlebarBrandSlot();
  return slot ? createPortal(<span>Workspace</span>, slot) : null;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it('moves the sidebar brand into the current titlebar when the titlebar remounts', () => {
  vi.spyOn(desktopClient, 'platform').mockReturnValue('win32');
  const view = render(
    <>
      <Brand />
      <Titlebar key="one" />
    </>
  );
  const first = screen.getByText('Workspace').parentElement;
  expect(first?.id).toBe('titlebar-brand-slot');
  view.rerender(
    <>
      <Brand />
      <Titlebar key="two" />
    </>
  );
  const second = screen.getByText('Workspace').parentElement;
  expect(second?.id).toBe('titlebar-brand-slot');
  expect(second).not.toBe(first);
  view.rerender(<Brand />);
  expect(screen.queryByText('Workspace')).toBeNull();
});
