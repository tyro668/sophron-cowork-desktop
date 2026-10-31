import { describe, expect, it } from 'vitest';
import {
  buildFixPayload,
  collectSecretValues,
  diffHunks,
  diffLines,
  evaluatePass,
  extractRunNotices,
  expectedColumnsFromAnalysis,
  expectedColumnsFromManifest,
  formatErrorReportText,
  parseErrorReport,
  predictFixDraft,
  describeConfigInput,
  redactSecrets,
  relativizePaths,
  runAutoFixLoop,
  sampleRows,
  stripErrorPrefix,
  tailBytes,
} from '../../src/shared/fix-error';

const RUN = '/home/box/.config/sophron/data/normalizers/abc/.sophron/run/v1';
const NORMALIZER_ERROR = [
  `Error invoking remote method 'data.previewRawTableNormalizerVersion': DataCommandError: [RUN_FAILED] Normalizer command failed with exit code 1: Traceback (most recent call last):`,
  `  File "/usr/lib/python3.12/runpy.py", line 198, in _run_module_as_main`,
  `    return _run_code(code, main_globals, None,`,
  `  File "${RUN}/normalizer/cli.py", line 25, in <module>`,
  `    main()`,
  `  File "${RUN}/normalizer/transform.py", line 51, in _parse_rows`,
  `    for row in reader:`,
  `_csv.Error: field larger than field limit (131072)`,
].join('\n');

describe('error report parsing', () => {
  it('strips the IPC prefix and pulls the exit code', () => {
    const stripped = stripErrorPrefix(NORMALIZER_ERROR);
    expect(stripped.exitCode).toBe(1);
    expect(stripped.text.startsWith('Traceback')).toBe(true);
  });

  it('keeps line breaks, relativizes paths and locates the project frame', () => {
    const report = parseErrorReport({ error: NORMALIZER_ERROR, durationMs: 420 }, [
      'normalizer/cli.py',
      'normalizer/transform.py',
    ]);
    expect(report.message).toBe('_csv.Error: field larger than field limit (131072)');
    expect(report.location).toEqual({
      file: 'normalizer/transform.py',
      line: 51,
      func: '_parse_rows',
    });
    expect(report.exitCode).toBe(1);
    expect(report.traceback.split('\n').length).toBeGreaterThan(5);
    expect(report.traceback).not.toContain('/home/box');
    expect(report.traceback).not.toContain('Error invoking remote method');
    expect(report.traceback).toContain('File "<python>/runpy.py"');
    expect(report.traceback).toContain('File "normalizer/cli.py"');
  });

  it('parses script runs (reason + log) and node stacks', () => {
    const py = parseErrorReport(
      {
        error: "KeyError: 'name'",
        log: [
          'Traceback (most recent call last):',
          '  File "/root/.config/sophron/scripts/p1/.sophron/run/trial/main.py", line 12, in <module>',
          '    run()',
          '  File "/root/.config/sophron/scripts/p1/.sophron/run/trial/parser.py", line 3, in parse_item',
          '    return raw["name"]',
          "KeyError: 'name'",
        ].join('\n'),
        exitCode: 1,
      },
      ['main.py', 'parser.py', 'manifest.json']
    );
    expect(py.location).toEqual({ file: 'parser.py', line: 3, func: 'parse_item' });
    expect(py.traceback.match(/KeyError/g)?.length).toBe(1);
    const node = parseErrorReport(
      {
        error: 'TypeError: x is not a function',
        log: [
          'TypeError: x is not a function',
          '    at parse (/Users/a/scripts/p/.sophron/run/trial/lib/parse.js:7:3)',
          '    at main (/Users/a/scripts/p/.sophron/run/trial/main.js:4:1)',
          '    at node:internal/main:1:1',
        ].join('\n'),
      },
      ['lib/parse.js', 'main.js']
    );
    expect(node.location).toEqual({ file: 'lib/parse.js', line: 7, func: 'parse' });
  });

  it('hides any other absolute path', () => {
    expect(relativizePaths('open /srv/data/in/orders.csv failed')).toBe('open …/orders.csv failed');
    expect(relativizePaths('C:\\Users\\bob\\x\\y.py')).not.toContain('bob');
  });
});

describe('fix payload and redaction', () => {
  const files = [
    { path: 'normalizer/cli.py', content: 'from .transform import transform\n' },
    {
      path: 'normalizer/transform.py',
      content: 'import csv\nAPI_TOKEN = "abcd1234efgh5678"\ndef _parse_rows(t):\n  pass\n',
    },
    { path: 'pyproject.toml', content: '[project]\n' },
  ];
  const secret = 'fr_live_9f8e7d6c5b4a39281706';

  it('sends error, relative stack, failing file in full and the other file names', () => {
    const payload = buildFixPayload({
      request: { error: NORMALIZER_ERROR, note: '备注列可能很长' },
      files,
      input: { label: `${RUN}/orders.csv · CSV`, rows: [{ a: 'x'.repeat(500) }] },
    });
    expect(payload.error).toContain('_csv.Error');
    expect(payload.location?.file).toBe('normalizer/transform.py');
    expect(payload.failingFile?.path).toBe('normalizer/transform.py');
    expect(payload.stackFiles?.map((file) => file.path)).toEqual(['normalizer/cli.py']);
    expect(payload.otherFiles).toEqual(['pyproject.toml']);
    expect(payload.userNote).toBe('备注列可能很长');
    expect(payload.callStack.every((frame) => !frame.file.startsWith('/'))).toBe(true);
    expect(String((payload.input?.sampleRows[0] as { a: string }).a).length).toBeLessThan(260);
    expect(JSON.stringify(payload)).not.toMatch(/\/home\/|\/usr\/lib/);
  });

  it('never includes env values, tokens or absolute paths', () => {
    const env = {
      FINERES_TOKEN: secret,
      HOME: '/home/box',
      OPENAI_API_KEY: 'sk-abcdefghijklmnopqrstuv',
    };
    const secrets = collectSecretValues(env);
    expect(secrets).toContain(secret);
    expect(secrets).not.toContain('/home/box');
    const payload = buildFixPayload({
      request: {
        error: `RuntimeError: auth failed for ${secret}`,
        log: `FINERES_TOKEN=${secret}\nAuthorization: Bearer ${secret}abcdef\nGET https://api.x.com/v1?token=${secret}&q=1\nPATH=/usr/bin\n${'x'.repeat(9000)}\nRuntimeError: auth failed`,
        exitCode: 1,
      },
      files,
      input: { rows: [{ cookie: secret }] },
      secrets,
    });
    const text = JSON.stringify(payload);
    expect(text).not.toContain(secret);
    expect(text).not.toContain('abcd1234efgh5678');
    expect(text).not.toContain('/usr/bin');
    expect(text).toContain('[REDACTED]');
    expect(new TextEncoder().encode(payload.stderrTail).length).toBeLessThanOrEqual(4096);
  });

  it('falls back to the primary file when no project frame exists', () => {
    const payload = buildFixPayload({
      request: { error: '通过但结果异常：「商品」列全为空' },
      files,
      primaryFile: 'normalizer/transform.py',
    });
    expect(payload.failingFile?.path).toBe('normalizer/transform.py');
    expect(payload.otherFiles).toEqual(['normalizer/cli.py', 'pyproject.toml']);
  });

  it('redacts common token shapes without a known value', () => {
    const out = redactSecrets(
      'ghp_abcdefghijklmnopqrstuvwxyz12 eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.abcdefghijk https://u:p4ss@h.com {"apiKey": "zzzzzzzz"}'
    );
    expect(out).not.toMatch(/ghp_|eyJhbGci|p4ss|zzzzzzzz/);
  });

  it('copy text uses the same redaction', () => {
    const report = parseErrorReport({ error: `ValueError: bad ${secret}` });
    expect(formatErrorReportText(report, { note: 'n' }, [secret])).not.toContain(secret);
  });

  it('caps samples at 20 rows and tails stderr at 4 KB', () => {
    expect(sampleRows(Array.from({ length: 50 }, (_, i) => [i]))).toHaveLength(20);
    expect(tailBytes('a\n'.repeat(5000)).length).toBeLessThanOrEqual(4096);
  });
});

describe('pass criteria', () => {
  it('fails on a non-zero exit', () => {
    expect(evaluatePass({ ok: false, error: NORMALIZER_ERROR })).toMatchObject({
      ok: false,
      reason: '_csv.Error: field larger than field limit (131072)',
    });
    expect(evaluatePass({ ok: true, exitCode: 2 }).ok).toBe(false);
  });

  it('flags missing expected columns and entirely empty expected columns', () => {
    const expected = [{ name: '商品' }, { name: '价格' }, { name: '备注', nullable: true }];
    const missing = evaluatePass({
      ok: true,
      columns: ['商品'],
      rows: [{ 商品: 'a' }],
      expectedColumns: expected,
    });
    expect(missing).toMatchObject({ ok: false, suspicious: true });
    expect(missing.reason).toContain('缺少列 价格');
    const empty = evaluatePass({
      ok: true,
      columns: ['商品', '价格', '备注'],
      rows: [
        { 商品: '', 价格: '1', 备注: '' },
        { 商品: ' ', 价格: '2', 备注: '' },
      ],
      expectedColumns: expected,
    });
    expect(empty.ok).toBe(false);
    expect(empty.reason).toBe('通过但结果异常：「商品」列全为空');
    expect(
      evaluatePass({
        ok: true,
        columns: ['商品', '价格', '备注'],
        rows: [{ 商品: 'a', 价格: '1', 备注: '' }],
        expectedColumns: expected,
      })
    ).toEqual({ ok: true });
  });

  it('reads expected columns from the analysis doc and the manifest', () => {
    expect(
      expectedColumnsFromAnalysis(
        JSON.stringify({
          sourceStructureAnalysis: {
            outputColumns: [{ name: 'a' }, { name: 'b', nullable: true }],
          },
        })
      )
    ).toEqual([{ name: 'a' }, { name: 'b', nullable: true }]);
    expect(
      expectedColumnsFromManifest(
        JSON.stringify({
          output: {
            columns: [
              'x',
              { name: 'n', type: 'number', nullable: true },
              { name: 'z', type: 'bogus' },
            ],
          },
        })
      )
    ).toEqual([{ name: 'x' }, { name: 'n', type: 'number', nullable: true }, { name: 'z' }]);
    expect(
      expectedColumnsFromManifest(JSON.stringify({ output: { columns: ['x', 'y'] } }))
    ).toEqual([{ name: 'x' }, { name: 'y' }]);
    expect(expectedColumnsFromManifest('not json')).toEqual([]);
  });
});

describe('auto-fix loop', () => {
  it('stops at the round limit with one row per failed round', async () => {
    let fixes = 0;
    const result = await runAutoFixLoop({
      maxRounds: 3,
      initialFailure: { message: 'KeyError' },
      fix: async () => {
        fixes += 1;
        return { version: 3 };
      },
      verify: async (round) => ({ message: `还是失败 ${round}` }),
    });
    expect(fixes).toBe(3);
    expect(result).toMatchObject({ passed: false, stoppedReason: 'limit' });
    expect(result.rounds.map((round) => round.reason)).toEqual([
      '还是失败 1',
      '还是失败 2',
      '还是失败 3',
    ]);
    expect(result.rounds.every((round) => round.version === 3)).toBe(true);
  });

  it('passes previous reasons along and stops once a rerun passes', async () => {
    const seen: string[][] = [];
    const result = await runAutoFixLoop({
      maxRounds: 5,
      initialFailure: { message: 'A' },
      fix: async (failure, _round, previous) => {
        seen.push([failure.message, ...previous]);
        return { summary: '清洗金额' };
      },
      verify: async (round) => (round < 2 ? { message: '通过但结果异常：「名称」列全为空' } : null),
    });
    expect(result.passed).toBe(true);
    expect(result.rounds).toHaveLength(2);
    // Round 2 sees the original error and what round 1 changed, so it keeps that fix.
    expect(seen[1]).toEqual([
      '通过但结果异常：「名称」列全为空',
      '原始报错：A',
      '第 1 轮改动「清洗金额」后仍未通过：通过但结果异常：「名称」列全为空',
    ]);
  });

  it('clamps the limit and stops on a fix error', async () => {
    let calls = 0;
    const result = await runAutoFixLoop({
      maxRounds: 99,
      initialFailure: { message: 'A' },
      fix: async () => {
        calls += 1;
        if (calls === 2) throw new Error('模型没有返回内容');
        return {};
      },
      verify: async () => ({ message: 'B' }),
    });
    expect(result.stoppedReason).toBe('fix_error');
    expect(result.rounds.at(-1)).toMatchObject({ status: 'error', reason: '模型没有返回内容' });
    const zero = await runAutoFixLoop({
      maxRounds: 0,
      initialFailure: { message: 'A' },
      fix: async () => ({}),
      verify: async () => ({ message: 'B' }),
    });
    expect(zero.rounds).toHaveLength(1);
  });
});

describe('line diff', () => {
  it('produces add/del lines and hunks with context', () => {
    const before = ['import csv', 'import io', 'def f():', '  return 1'].join('\n');
    const after = ['import csv', 'import io', 'import sys', 'def f():', '  return 2'].join('\n');
    const lines = diffLines(before, after);
    expect(lines.filter((line) => line.kind === 'add').map((line) => line.text)).toEqual([
      'import sys',
      '  return 2',
    ]);
    expect(lines.filter((line) => line.kind === 'del').map((line) => line.text)).toEqual([
      '  return 1',
    ]);
    const hunks = diffHunks(lines, 1);
    expect(hunks).toHaveLength(1);
    expect(hunks[0].header).toMatch(/^@@ -2,/);
  });
});

describe('fix target (draft overwrite)', () => {
  it('overwrites the newest unpublished AI 修复 draft, otherwise adds a version', () => {
    expect(
      predictFixDraft([
        { version: 1, status: 'published', source: 'rule' },
        { version: 2, status: 'draft', source: 'manual' },
      ])
    ).toEqual({ version: 3, overwrite: false });
    expect(
      predictFixDraft([
        { version: 1, status: 'published', source: 'rule' },
        { version: 2, status: 'draft', source: 'ai_repair' },
      ])
    ).toEqual({ version: 2, overwrite: true });
    expect(
      predictFixDraft([
        { version: 1, status: 'archived', source: 'rule' },
        { version: 2, status: 'published', source: 'ai_repair' },
      ])
    ).toEqual({ version: 3, overwrite: false });
    expect(predictFixDraft([])).toEqual({ version: 1, overwrite: false });
  });

  it('describes config.json input', () => {
    expect(describeConfigInput('{"items":[1,2]}')).toBe('config.json · items 2 条');
    expect(describeConfigInput('{"url":"x"}')).toBe('config.json · 1 项参数');
    expect(describeConfigInput(undefined)).toBe('');
  });
});

describe('fix console stream', () => {
  it('shows the decoded analysis and one line per file, never raw JSON', async () => {
    const { createFixStreamSplitter, diffLines } = await import('../../src/shared/fix-error');
    const events: Array<{ phase: string; kind: string; text: string }> = [];
    const push = createFixStreamSplitter((event) => events.push(event));
    const json = JSON.stringify({
      analysis: '折扣为"无"时 float() 报错。\n按 1 处理。',
      files: [{ path: 'normalizer/transform.py', content: 'x = 1\n' }],
      summary: '修复折扣',
    });
    for (let index = 0; index < json.length; index += 7) push(json.slice(index, index + 7));
    const analysis = events
      .filter((event) => event.phase === 'source_analysis')
      .map((event) => event.text)
      .join('');
    expect(analysis).toBe('折扣为"无"时 float() 报错。\n按 1 处理。');
    expect(events.filter((event) => event.phase === 'code_generation')).toEqual([
      { phase: 'code_generation', kind: 'message', text: '修改 normalizer/transform.py' },
    ]);
    expect(events.some((event) => event.text.includes('content'))).toBe(false);
    const diff = diffLines('a\nold\nc', 'a\nnew\nc').map((line) => line.kind);
    expect(diff).toEqual(['same', 'del', 'add', 'same']);
  });
});

describe('pass-check verdict as error', () => {
  it('keeps the verdict reason, not the last sample row', async () => {
    const { parseErrorReport } = await import('../../src/shared/fix-error');
    const report = parseErrorReport({
      error: '通过但结果异常：「store」列全为空\n输出预览：\norder_id,store\nA1,',
    });
    expect(report.message).toBe('通过但结果异常：「store」列全为空');
  });
});

describe('output shape checks', () => {
  const rows = (list: Array<Record<string, string>>) => list;
  it('fails duplicate columns, ragged rows and repeated header rows', () => {
    expect(
      evaluatePass({ ok: true, columns: ['a', 'a'], rows: rows([{ a: '1' }]) }).reason
    ).toContain('列名重复');
    expect(
      evaluatePass({
        ok: true,
        columns: ['a', 'b'],
        rows: rows([{ a: '1', b: '2' }]),
        raggedRows: 2,
      }).reason
    ).toContain('2 行的列数与表头不一致');
    const repeated = evaluatePass({
      ok: true,
      columns: ['名称', '价格'],
      rows: rows([
        { 名称: '苹果', 价格: '3' },
        { 名称: '名称', 价格: '价格' },
      ]),
    });
    expect(repeated).toMatchObject({ ok: false, suspicious: true });
    expect(repeated.reason).toContain('重复的表头');
  });

  it('checks declared column types on the sample rows', () => {
    const bad = evaluatePass({
      ok: true,
      columns: ['名称', '价格'],
      rows: rows([
        { 名称: 'a', 价格: '3.5' },
        { 名称: 'b', 价格: '暂无报价' },
        { 名称: 'c', 价格: '免费' },
      ]),
      expectedColumns: [{ name: '名称' }, { name: '价格', type: 'number' }],
    });
    expect(bad.reason).toContain('「价格」应为数字，2/3 行不是');
    expect(
      evaluatePass({
        ok: true,
        columns: ['日期', '数量'],
        rows: rows([
          { 日期: '2026-10-31', 数量: '1,200' },
          { 日期: '2026/10/30 08:00', 数量: '35' },
        ]),
        expectedColumns: [
          { name: '日期', type: 'date' },
          { name: '数量', type: 'integer' },
        ],
      })
    ).toEqual({ ok: true });
  });

  it('fails placeholder-only required columns and warns about single values, duplicates and notices', () => {
    expect(
      evaluatePass({
        ok: true,
        columns: ['名称', '链接'],
        rows: rows([
          { 名称: 'a', 链接: 'N/A' },
          { 名称: 'b', 链接: 'N/A' },
        ]),
        expectedColumns: [{ name: '名称' }, { name: '链接' }],
      }).reason
    ).toContain('「链接」列全是占位值');
    const same = Array.from({ length: 6 }, () => ({ 城市: '上海', 名称: 'x' }));
    const warned = evaluatePass({
      ok: true,
      columns: ['城市', '名称'],
      rows: rows(same),
      notices: ['今日榜单为空，已改用本周榜单'],
    });
    expect(warned.ok).toBe(true);
    expect(warned.warnings).toEqual([
      '今日榜单为空，已改用本周榜单',
      '「城市」列所有行都是同一个值「上海」',
      '「名称」列所有行都是同一个值「x」',
      '5 行与其他行完全重复',
    ]);
    expect(
      extractRunNotices('x\nSOPHRON_NOTICE: 已改用周榜\nSOPHRON_NOTICE: 已改用周榜\n')
    ).toEqual(['已改用周榜']);
  });
});
