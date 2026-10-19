import { describe, expect, it } from 'vitest';
import { isReadOnlyShellCommand } from '../src/shared/read-only-command';

describe('isReadOnlyShellCommand', () => {
  it.each([
    'ls',
    'ls -la /home/box/data',
    'cat 销售订单.csv | head -20',
    'head -n 5 a.csv && wc -l a.csv',
    'pdftotext -layout report.pdf - | grep 总计',
    'cd /home/box/data && ls -la',
    'find . -name "*.xlsx" 2>/dev/null',
    'rg -n TODO src',
    'git status && git log --oneline -5',
    'LANG=C sort data.txt | uniq -c',
  ])('treats %s as read-only', (command) => {
    expect(isReadOnlyShellCommand(command)).toBe(true);
  });

  it.each([
    '',
    'rm -rf build',
    'cat > brief.js <<EOF',
    'echo hi > out.txt',
    'ls; rm a',
    'python3 clean_report.py',
    'find . -name "*.tmp" -delete',
    'find . -exec rm {} \\;',
    'sort -o data.txt data.txt',
    'cat $(ls)',
    'git commit -m x',
    'git branch -D main',
    'sed -i s/a/b/ file',
    'npm install',
    'sleep 10 &',
  ])('treats %s as potentially modifying', (command) => {
    expect(isReadOnlyShellCommand(command)).toBe(false);
  });
  it('only allows listing forms of git branch/remote', () => {
    expect(isReadOnlyShellCommand('git branch -a')).toBe(true);
    expect(isReadOnlyShellCommand('git remote -v')).toBe(true);
    expect(isReadOnlyShellCommand('git branch feature')).toBe(false);
    expect(isReadOnlyShellCommand('git remote add o url')).toBe(false);
  });
});
