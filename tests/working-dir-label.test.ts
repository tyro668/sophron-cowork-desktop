import { describe, expect, it } from 'vitest';
import { getWorkingDirDisplayName } from '../src/renderer/utils/working-dir-label';

describe('working directory display label', () => {
  it('localizes the internal default_working_dir folder name', () => {
    expect(
      getWorkingDirDisplayName(
        '/Users/demo/Library/Application Support/sophron/default_working_dir',
        '默认工作目录',
        '选择工作文件夹'
      )
    ).toBe('默认工作目录');
  });

  it('shows the selected folder basename for user-picked directories', () => {
    expect(getWorkingDirDisplayName('/Users/demo/data/reports', 'Default', 'Select')).toBe(
      'reports'
    );
  });

  it('uses the empty label when no working directory exists', () => {
    expect(getWorkingDirDisplayName(null, 'Default', 'Select')).toBe('Select');
  });
});
