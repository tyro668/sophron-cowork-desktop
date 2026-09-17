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
  cn,
  Dialog,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
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

  it('traps Tab focus inside the panel', () => {
    function Fixture() {
      const [open, setOpen] = React.useState(false);
      return (
        <>
          <button data-testid="outside" onClick={() => setOpen(true)}>
            outside
          </button>
          <Dialog open={open} onOpenChange={setOpen} ariaLabel="d">
            <button data-testid="first">first</button>
            <button data-testid="last">last</button>
          </Dialog>
        </>
      );
    }
    render(<Fixture />);
    fireEvent.click(screen.getByTestId('outside'));
    const first = screen.getByTestId('first');
    const last = screen.getByTestId('last');
    const panel = screen.getByRole('dialog');

    // autofocus lands on the panel itself (no data-autofocus here)
    expect(document.activeElement).toBe(panel);
    const pressTab = (shiftKey = false) =>
      fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Tab', shiftKey });
    // Tab on panel (focus outside items) → wraps to first
    pressTab();
    expect(document.activeElement).toBe(first);
    // Tab on last → wraps to first
    last.focus();
    pressTab();
    expect(document.activeElement).toBe(first);
    // Shift+Tab on first → wraps to last
    first.focus();
    pressTab(true);
    expect(document.activeElement).toBe(last);
  });

  it('does not re-run initial focus when onOpenChange identity changes', () => {
    function Fixture() {
      const [open, setOpen] = React.useState(true);
      const [tick, setTick] = React.useState(0);
      return (
        <>
          <button data-testid="tick" onClick={() => setTick((n) => n + 1)}>
            {tick}
          </button>
          <Dialog open={open} onOpenChange={() => setOpen(false)} ariaLabel="d">
            <button data-autofocus data-testid="inside">
              inside
            </button>
          </Dialog>
        </>
      );
    }
    render(<Fixture />);
    const inside = screen.getByTestId('inside');
    expect(document.activeElement).toBe(inside);
    // Move focus away from the autofocus target inside the dialog
    inside.blur();
    // Re-render with a new inline onOpenChange identity — focus must not jump back
    fireEvent.click(screen.getByTestId('tick'));
    expect(document.activeElement).not.toBe(inside);
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

describe('cn', () => {
  it('lets caller classes win on tailwind conflicts', () => {
    expect(cn('w-full', 'w-32')).toBe('w-32');
    expect(cn('max-w-md', 'max-w-[24rem]')).toBe('max-w-[24rem]');
    expect(cn('h-8 px-3', undefined, 'px-4')).toBe('h-8 px-4');
  });
});

describe('Select', () => {
  it('opens on Enter, selects an item by click, reports value', async () => {
    const onValueChange = vi.fn();
    render(
      <Select onValueChange={onValueChange}>
        <SelectTrigger aria-label="pick">
          <SelectValue placeholder="choose" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="a">Alpha</SelectItem>
          <SelectItem value="b">Beta</SelectItem>
        </SelectContent>
      </Select>
    );
    const trigger = screen.getByRole('combobox');
    fireEvent.keyDown(trigger, { key: 'Enter' });
    const option = await screen.findByRole('option', { name: 'Beta' });
    fireEvent.click(option);
    expect(onValueChange).toHaveBeenCalledWith('b');
  });
});

describe('DropdownMenu', () => {
  it('opens via keyboard and fires item onSelect', async () => {
    const onSelect = vi.fn();
    render(
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button>menu</Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem onSelect={onSelect}>item</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
    const trigger = screen.getByRole('button', { name: 'menu' });
    fireEvent.keyDown(trigger, { key: 'Enter' });
    const item = await screen.findByRole('menuitem', { name: 'item' });
    fireEvent.click(item);
    expect(onSelect).toHaveBeenCalled();
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
