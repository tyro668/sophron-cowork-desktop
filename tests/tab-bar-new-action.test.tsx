// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import fs from 'node:fs';
import path from 'node:path';
import {
  TabBarAction,
  TabBarActionSlot,
  tabBarNewCellClass,
  useTabBarActionSlot,
} from '../src/renderer/components/data-view/shared';

function Page({ onCreate }: { onCreate: () => void }) {
  const bar = useTabBarActionSlot();
  return (
    <bar.Provider value={bar.slot}>
      <div data-testid="tabbar">
        <TabBarActionSlot slotRef={bar.slotRef} />
      </div>
      <div data-testid="toolbar">
        <TabBarAction>
          <button className={tabBarNewCellClass} onClick={onCreate}>
            新建
          </button>
        </TabBarAction>
      </div>
    </bar.Provider>
  );
}

describe('tab bar 新建 action', () => {
  it('portals the button into the tab bar slot and keeps its handler', () => {
    const onCreate = vi.fn();
    render(<Page onCreate={onCreate} />);
    const button = screen.getByText('新建');
    expect(screen.getByTestId('tabbar').contains(button)).toBe(true);
    expect(screen.getByTestId('toolbar').contains(button)).toBe(false);
    fireEvent.click(button);
    expect(onCreate).toHaveBeenCalledTimes(1);
  });

  it('renders inline without a slot', () => {
    render(
      <TabBarAction>
        <button>inline</button>
      </TabBarAction>
    );
    expect(screen.getByText('inline')).toBeTruthy();
  });

  it('is a restrained accent cell with a left divider, used by all list pages', () => {
    expect(tabBarNewCellClass).toContain('border-l');
    expect(tabBarNewCellClass).toContain('text-accent');
    expect(tabBarNewCellClass).not.toContain('jade-primary-button');
    for (const f of [
      'src/renderer/components/data-view/data-pipelines/PipelinesPanel.tsx',
      'src/renderer/components/data-view/raw-tables.tsx',
      'src/renderer/components/data-view/result-tables.tsx',
      'src/renderer/components/settings/schedule/listPanels.tsx',
    ]) {
      const src = fs.readFileSync(path.resolve(process.cwd(), f), 'utf8');
      expect(src).toContain('className={tabBarNewCellClass}');
    }
  });
});
