// @vitest-environment happy-dom
/**
 * Behavior tests for the shared `src/renderer/components/ui` primitives and the
 * Glass* compatibility adapters: rendering, interaction, focus handling, and
 * Esc/overlay semantics.
 */
import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  Badge,
  Button,
  Dialog,
  DialogTitle,
  Input,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '../../src/renderer/components/ui';
import { GlassSwitch } from '../../src/renderer/components/GlassSwitch';
import {
  ConfirmDialogProvider,
  useConfirmDialog,
} from '../../src/renderer/components/ConfirmDialog';
import './i18n-test';

describe('Button', () => {
  it('fires onClick and respects disabled', () => {
    const onClick = vi.fn();
    const { rerender } = render(<Button onClick={onClick}>ok</Button>);
    fireEvent.click(screen.getByRole('button', { name: 'ok' }));
    expect(onClick).toHaveBeenCalledTimes(1);

    rerender(
      <Button onClick={onClick} disabled>
        ok
      </Button>
    );
    fireEvent.click(screen.getByRole('button', { name: 'ok' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('loading state disables the button and shows a spinner', () => {
    const onClick = vi.fn();
    render(
      <Button variant="primary" loading onClick={onClick}>
        save
      </Button>
    );
    const button = screen.getByRole('button', { name: 'save' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.querySelector('.animate-spin')).not.toBeNull();
  });
});

describe('Input', () => {
  it('marks error state via aria-invalid and error border', () => {
    render(<Input aria-label="f" error />);
    const input = screen.getByLabelText('f');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.className).toContain('border-error');
  });
});

describe('Switch', () => {
  it('toggles on click', () => {
    const onCheckedChange = vi.fn();
    render(<Switch checked={false} onCheckedChange={onCheckedChange} aria-label="sw" />);
    fireEvent.click(screen.getByRole('switch'));
    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });

  it('GlassSwitch adapter keeps the same API', () => {
    const onCheckedChange = vi.fn();
    render(<GlassSwitch checked={true} onCheckedChange={onCheckedChange} ariaLabel="sw" />);
    const sw = screen.getByRole('switch');
    expect(sw.getAttribute('aria-label')).toBe('sw');
    fireEvent.click(sw);
    expect(onCheckedChange).toHaveBeenCalledWith(false);
  });
});

describe('Tabs', () => {
  function TabsFixture() {
    const [value, setValue] = React.useState('a');
    return (
      <Tabs value={value} onValueChange={setValue}>
        <TabsList>
          <TabsTrigger value="a">A</TabsTrigger>
          <TabsTrigger value="b">B</TabsTrigger>
        </TabsList>
        <TabsContent value="a">panel-a</TabsContent>
        <TabsContent value="b">panel-b</TabsContent>
      </Tabs>
    );
  }

  it('switches panels on click', () => {
    render(<TabsFixture />);
    expect(screen.queryByText('panel-b')).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: 'B' }));
    expect(screen.getByText('panel-b')).toBeTruthy();
    expect(screen.queryByText('panel-a')).toBeNull();
    expect(screen.getByRole('tab', { name: 'B' }).getAttribute('aria-selected')).toBe('true');
  });

  it('arrow keys move focus between tabs', () => {
    render(<TabsFixture />);
    const tabA = screen.getByRole('tab', { name: 'A' });
    const tabB = screen.getByRole('tab', { name: 'B' });
    tabA.focus();
    fireEvent.keyDown(tabA.parentElement!, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(tabB);
  });
});

describe('Dialog', () => {
  it('closes on Escape and restores focus', () => {
    const onOpenChange = vi.fn();
    function Fixture() {
      const [open, setOpen] = React.useState(false);
      return (
        <>
          <button data-testid="trigger" onClick={() => setOpen(true)}>
            open
          </button>
          <Dialog
            open={open}
            onOpenChange={(v) => {
              setOpen(v);
              onOpenChange(v);
            }}
            ariaLabel="d"
          >
            <DialogTitle>title</DialogTitle>
            <button data-autofocus>inside</button>
          </Dialog>
        </>
      );
    }
    render(<Fixture />);
    const trigger = screen.getByTestId('trigger');
    trigger.focus();
    fireEvent.click(trigger);
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByText('inside'));

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('overlay click only closes when closeOnOverlayClick', () => {
    const onOpenChange = vi.fn();
    render(
      <Dialog open onOpenChange={onOpenChange} ariaLabel="d">
        <DialogTitle>t</DialogTitle>
      </Dialog>
    );
    const overlay = document.body.querySelector('.fixed.inset-0') as HTMLElement;
    fireEvent.mouseDown(overlay);
    expect(onOpenChange).not.toHaveBeenCalled();
  });
});

describe('Badge', () => {
  it('applies tone classes', () => {
    render(<Badge tone="error">err</Badge>);
    expect(screen.getByText('err').className).toContain('text-error');
  });
});

describe('ConfirmDialog adapter', () => {
  function ConfirmHarness({ onResult }: { onResult: (v: boolean) => void }) {
    const { confirm } = useConfirmDialog();
    return (
      <button
        onClick={() => {
          void confirm({ message: 'sure?' }).then(onResult);
        }}
      >
        ask
      </button>
    );
  }

  it('resolves true on confirm and false on cancel', async () => {
    const onResult = vi.fn();
    render(
      <ConfirmDialogProvider>
        <ConfirmHarness onResult={onResult} />
      </ConfirmDialogProvider>
    );
    fireEvent.click(screen.getByText('ask'));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toBeTruthy();

    fireEvent.click(screen.getByText('Yes'));
    await act(async () => {});
    expect(onResult).toHaveBeenCalledWith(true);

    fireEvent.click(screen.getByText('ask'));
    await screen.findByRole('dialog');
    fireEvent.click(screen.getByText('Cancel'));
    await act(async () => {});
    expect(onResult).toHaveBeenLastCalledWith(false);
  });
});
