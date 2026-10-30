/**
 * Tools for headless editor agents (script packages, raw-table normalizers): file tools confined
 * to one working directory, bash with that directory as cwd, and web fetch / search.
 */
import os from 'os';
import path from 'path';
import { Type } from 'typebox';
import type { AgentTool } from '@earendil-works/pi-agent-core';
import {
  createBashTool,
  createEditTool,
  createLsTool,
  createReadTool,
  createWriteTool,
  type BashToolOptions,
} from '@earendil-works/pi-coding-agent';
import { createWindowsBashOperations } from './windows-bash-operations';
import { duckDuckGoSearch } from '../tools/web-search';

/** Tool list element (tools differ in their parameter schemas). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyAgentTool = AgentTool<any>;

/** Folders inside a workspace the agent may never write (git, deps, app state). */
const PROTECTED_DIRS = new Set(['.git', '.sophron', '.venv', 'node_modules', '__pycache__']);
const SECRET_ENV = /(KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|COOKIE|SESSION)/i;
const DEFAULT_BASH_TIMEOUT_SECONDS = 120;
const FETCH_BODY_LIMIT = 20_000;

export const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

function isInside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function resolveIn(root: string, value: unknown): string {
  const raw = typeof value === 'string' && value.trim() ? value.trim() : '.';
  return path.resolve(root, raw.replace(/^@/, ''));
}

function guardPath(
  tool: AnyAgentTool,
  check: (absolute: string) => string | null,
  root: string
): AnyAgentTool {
  return {
    ...tool,
    execute: async (id, params, signal, onUpdate) => {
      const problem = check(resolveIn(root, (params as { path?: unknown }).path));
      if (problem) throw new Error(problem);
      return tool.execute(id, params, signal, onUpdate);
    },
  };
}

export interface WorkspaceToolsOptions {
  /** The only folder file tools may write; bash runs here. */
  dir: string;
  /** Include bash (network exploration, running code). */
  bash?: boolean;
  /** Include webfetch / websearch. */
  web?: boolean;
}

/** read / ls / write / edit confined to `dir` (reads may also look at the temp folder). */
export function createWorkspaceTools(options: WorkspaceToolsOptions): AnyAgentTool[] {
  const root = path.resolve(options.dir);
  const tmp = path.resolve(os.tmpdir());
  const inRoot = (absolute: string) => isInside(root, absolute);
  const readable = (absolute: string) =>
    inRoot(absolute) || isInside(tmp, absolute)
      ? null
      : `只能读取工作目录内的文件（${path.basename(root)}）`;
  const writable = (absolute: string) => {
    if (!inRoot(absolute)) return `只能写入工作目录内的文件（${path.basename(root)}）`;
    const parts = path.relative(root, absolute).split(path.sep);
    if (parts.some((part) => PROTECTED_DIRS.has(part)))
      return `不能写入 ${parts.find((part) => PROTECTED_DIRS.has(part))}/`;
    return null;
  };
  const tools: AnyAgentTool[] = [
    guardPath(createReadTool(root), readable, root),
    guardPath(createLsTool(root), readable, root),
    guardPath(createWriteTool(root), writable, root),
    guardPath(createEditTool(root), writable, root),
  ];
  if (options.bash) tools.push(createWorkspaceBashTool(root));
  if (options.web) tools.push(createWebFetchTool(), createWebSearchTool());
  return tools;
}

/** Environment for agent shells: no API keys, tokens or other secrets of the app. */
export function scrubbedEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const next: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(env)) {
    if (SECRET_ENV.test(key)) continue;
    next[key] = value;
  }
  return next;
}

function createWorkspaceBashTool(root: string): AnyAgentTool {
  const options: BashToolOptions = {
    exposeSessionEnvironment: false,
    spawnHook: (context) => ({ ...context, cwd: root, env: scrubbedEnv(context.env) }),
    ...(process.platform === 'win32' ? { operations: createWindowsBashOperations() } : {}),
  };
  const tool = createBashTool(root, options);
  return {
    ...tool,
    execute: (
      id: string,
      params: { command: string; timeout?: number },
      signal?: AbortSignal,
      onUpdate?: never
    ) =>
      tool.execute(
        id,
        params.timeout != null ? params : { ...params, timeout: DEFAULT_BASH_TIMEOUT_SECONDS },
        signal,
        onUpdate
      ),
  } as AnyAgentTool;
}

const webFetchSchema = Type.Object({
  url: Type.String({ description: 'http(s) URL' }),
  headers: Type.Optional(
    Type.Record(Type.String(), Type.String(), {
      description:
        'Request headers, e.g. {"Referer": "https://site/"}. A browser User-Agent is sent by default.',
    })
  ),
  method: Type.Optional(Type.Union([Type.Literal('GET'), Type.Literal('POST')])),
  body: Type.Optional(Type.String({ description: 'POST body (send Content-Type in headers)' })),
  offset: Type.Optional(Type.Number({ description: 'Start of the body slice (chars)' })),
});

export function createWebFetchTool(): AgentTool<typeof webFetchSchema> {
  return {
    name: 'webfetch',
    label: 'webfetch',
    description:
      'Fetch a URL and return status, content type, selected headers and the body (first 20000 chars from offset). Use it to look at pages, JS bundles and JSON APIs.',
    parameters: webFetchSchema,
    async execute(_id, params, signal) {
      const url = new URL(params.url);
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error('只支持 http/https');
      const response = await fetch(url, {
        method: params.method ?? 'GET',
        headers: { 'User-Agent': BROWSER_USER_AGENT, ...(params.headers ?? {}) },
        body: params.method === 'POST' ? params.body : undefined,
        redirect: 'follow',
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(20_000)])
          : AbortSignal.timeout(20_000),
      });
      const body = await response.text();
      const offset = Math.max(0, Math.floor(params.offset ?? 0));
      const slice = body.slice(offset, offset + FETCH_BODY_LIMIT);
      const headers = ['content-type', 'content-length', 'location', 'set-cookie']
        .map((name) => [name, response.headers.get(name)] as const)
        .filter(([, value]) => value)
        .map(([name, value]) => `${name}: ${name === 'set-cookie' ? '(set)' : value}`);
      const text = [
        `URL: ${response.url}`,
        `Status: ${response.status}`,
        ...headers,
        `Body length: ${body.length}`,
        '',
        slice,
        offset + FETCH_BODY_LIMIT < body.length
          ? `\n[Truncated: ${body.length - offset - FETCH_BODY_LIMIT} more chars, pass offset=${offset + FETCH_BODY_LIMIT}]`
          : '',
      ].join('\n');
      return { content: [{ type: 'text', text }], details: undefined };
    },
  };
}

const webSearchSchema = Type.Object({ query: Type.String() });

export function createWebSearchTool(): AgentTool<typeof webSearchSchema> {
  return {
    name: 'websearch',
    label: 'websearch',
    description: 'Web search (DuckDuckGo instant answers). Returns a short abstract and links.',
    parameters: webSearchSchema,
    async execute(_id, params) {
      return {
        content: [{ type: 'text', text: await duckDuckGoSearch(params.query) }],
        details: undefined,
      };
    },
  };
}
