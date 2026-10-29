import { describe, expect, it } from 'vitest';
import {
  jsonRowsToCsv,
  parseCsv,
  readScriptOutput,
} from '../../src/main/automation/script-packages/output';
import { failureReason } from '../../src/main/automation/script-packages/process';

describe('script output parsing', () => {
  it('parses quoted CSV with embedded commas, quotes and newlines', () => {
    expect(parseCsv('\ufeffa,b\r\n"x, y","say ""hi"""\n"multi\nline",2\n')).toEqual([
      ['a', 'b'],
      ['x, y', 'say "hi"'],
      ['multi\nline', '2'],
    ]);
  });

  it('converts JSON object arrays (or {rows}) to CSV keeping first-seen column order', () => {
    expect(jsonRowsToCsv('[{"a":1,"b":"x,y"},{"c":null,"a":2}]')).toBe('a,b,c\n1,"x,y",\n2,,\n');
    expect(jsonRowsToCsv('{"rows":[{"k":true}]}')).toBe('k\ntrue\n');
    expect(() => jsonRowsToCsv('{"a":1}')).toThrow('对象数组');
  });

  it('counts rows and enforces manifest columns', () => {
    expect(readScriptOutput('date,rate\n2026-10-28,1.2\n2026-10-29,1.3\n', 'csv')).toMatchObject({
      columns: ['date', 'rate'],
      rows: 2,
    });
    expect(() => readScriptOutput('date\n1\n', 'csv', ['date', 'rate'])).toThrow(
      '结果缺少列：rate'
    );
    expect(() => readScriptOutput('', 'csv')).toThrow('结果文件为空');
  });

  it('uses the last stderr line as the failure reason', () => {
    expect(
      failureReason({
        code: 1,
        stdout: 'progress',
        stderr: 'Traceback (most recent call last):\n  File "main.py"\nValueError: 选择器失效\n',
        timedOut: false,
      })
    ).toBe('ValueError: 选择器失效');
    expect(failureReason({ code: 3, stdout: '', stderr: '', timedOut: false })).toBe('退出码 3');
  });
});
