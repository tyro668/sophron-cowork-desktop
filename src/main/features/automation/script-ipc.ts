import { shell } from 'electron';
import { handleIpc } from '../../ipc-handle';
import { appContext } from '../../app/context';
import { configStore } from '../../config/config-store';
import {
  resolveAppConfigForAuth,
  resolveModelRuntimeConfigForAutomation,
} from '../../app/runtime-config';
import { runPiAiOneShot } from '../../agent/pi-ai-one-shot';
import { buildChatScriptProposal } from '../../automation/script-packages/chat-proposal';
import { scriptFilesGenerator as generator } from './script-generator';
import {
  CHAT_SCRIPT_ATTACHMENTS_LIMIT,
  CHAT_SCRIPT_CODE_LIMIT,
  eligibleChatTurns,
  sanitizeForScript,
} from '../../../shared/chat-to-script';
import { collectSecretValues } from '../../../shared/fix-error';
import {
  getSecretStore,
  normalizerSecretScope,
  scriptSecretScope,
} from '../../exec-guard/secret-store';
import { SCRIPT_RUN_ACTION } from '../../../shared/automation/script-package';
import type {
  ScriptGenerateDraftInput,
  ScriptPackageEditorState,
} from '../../../shared/automation/script-package';
import type { ScriptRunTarget } from '../../automation/script-packages/service';

function requireScripts() {
  if (!appContext.scriptPackages) throw new Error('Script packages are not initialized');
  return appContext.scriptPackages;
}

/** Names of the automations whose 执行脚本 nodes run the package. */
export function scriptPackageUsers(packageId: string): string[] {
  const automations =
    appContext.automationStore?.list({ status: 'all', limit: 100_000 }).automations ?? [];
  return automations
    .filter((automation) =>
      automation.actionGraph.nodes.some(
        (node) => node.type === SCRIPT_RUN_ACTION && node.config?.packageId === packageId
      )
    )
    .map((automation) => automation.name);
}

function requireSession(sessionId: string) {
  const sessions = appContext.sessionManager;
  if (!sessions) throw new Error('Sessions are not initialized');
  const session = sessions.listSessions().find((item) => item.id === sessionId);
  if (!session) throw new Error('对话不存在或已删除');
  return { session, messages: sessions.getMessages(sessionId) };
}

/** Running 规则生成 / AI 修复 agents by progressId, for 取消. */
const running = new Map<string, AbortController>();

function secretScope(kind: 'script' | 'normalizer', id: string): string {
  return kind === 'script' ? scriptSecretScope(id) : normalizerSecretScope(id);
}

function requireSecretStore() {
  const store = getSecretStore();
  if (!store) throw new Error('密钥存储不可用');
  return store;
}

export function registerScriptPackageIpc(): void {
  handleIpc('automation.secrets.list', (_event, kind: 'script' | 'normalizer', id: string) =>
    requireSecretStore().list(secretScope(kind, id))
  );
  handleIpc(
    'automation.secrets.set',
    (_event, kind: 'script' | 'normalizer', id: string, name: string, value: string) =>
      requireSecretStore().set(secretScope(kind, id), name, value)
  );
  handleIpc(
    'automation.secrets.delete',
    (_event, kind: 'script' | 'normalizer', id: string, name: string) =>
      requireSecretStore().delete(secretScope(kind, id), name)
  );
  handleIpc('automation.scripts.cancelGenerate', (_event, progressId: string) => {
    running.get(progressId)?.abort();
    return { cancelled: running.has(progressId) };
  });
  handleIpc('automation.scripts.list', () => requireScripts().list());
  handleIpc('automation.scripts.get', (_event, id: string) => requireScripts().summary(id));
  handleIpc('automation.scripts.open', async (_event, id: string) => {
    const error = await shell.openPath(requireScripts().packageDir(id));
    if (error) throw new Error(error);
  });
  handleIpc(
    'automation.scripts.testRun',
    (_event, id: string, timeoutMs: number, target?: ScriptRunTarget) =>
      requireScripts().testRun(id, { timeoutMs, target: target ?? 'published' })
  );
  handleIpc('automation.scripts.versions', (_event, id: string) =>
    requireScripts().listVersions(id)
  );
  handleIpc('automation.scripts.versionDetail', (_event, id: string, version: number) =>
    requireScripts().versionDetail(id, version)
  );
  handleIpc('automation.scripts.publish', (_event, id: string, version: number) =>
    requireScripts().publish(id, version)
  );
  /** Delete a whole package; refused while an automation still runs it. */
  handleIpc('automation.scripts.delete', async (_event, id: string) => {
    const users = scriptPackageUsers(id);
    if (users.length > 0)
      throw new Error(`自动化「${users.join('」「')}」还在使用这个脚本包，请先在自动化里换掉`);
    await requireScripts().deletePackage(id);
    return { success: true };
  });
  handleIpc('automation.scripts.deleteVersion', (_event, id: string, version: number) =>
    requireScripts().deleteVersion(id, version)
  );
  handleIpc(
    'automation.scripts.setMeta',
    (_event, id: string, patch: { displayName?: string; editor?: ScriptPackageEditorState }) =>
      requireScripts().setMeta(id, patch)
  );
  handleIpc('automation.scripts.editorState', (_event, id: string) =>
    requireScripts().editorState(id)
  );
  handleIpc('automation.scripts.lastOutput', (_event, id: string) =>
    requireScripts().lastOutput(id)
  );
  /** 对话「转成脚本」: anchors of the qualifying turns (sidebar 任务操作 menu, propose card). */
  handleIpc('automation.scripts.chatTurns', (_event, sessionId: string) => {
    const { session, messages } = requireSession(sessionId);
    return eligibleChatTurns(messages, {
      running: session.status === 'running',
      sessionError: session.status === 'error',
    }).map((turn) => ({ turn: turn.turn, anchorId: turn.anchorId }));
  });
  handleIpc(
    'automation.scripts.chatProposal',
    async (_event, input: { sessionId: string; messageId?: string }) => {
      const { session, messages } = requireSession(input.sessionId);
      const config = await resolveAppConfigForAuth(configStore.getAll());
      return buildChatScriptProposal({
        sessionId: session.id,
        sessionTitle: session.title,
        sessionStatus: session.status,
        messages,
        messageId: input.messageId,
        packages: await requireScripts().list(),
        secrets: collectSecretValues(config),
        extract: async (prompt, systemPrompt) =>
          (
            await runPiAiOneShot(prompt, systemPrompt, config, {
              temperature: 0.1,
              maxTokens: 2000,
              reasoning: 'off',
            })
          ).text,
      });
    }
  );
  handleIpc('automation.scripts.generateDraft', async (event, raw: ScriptGenerateDraftInput) => {
    // References are redacted again here and kept within the attachment budget.
    let budget = CHAT_SCRIPT_ATTACHMENTS_LIMIT;
    const input: ScriptGenerateDraftInput = {
      ...raw,
      ...(raw.references
        ? {
            references: raw.references.flatMap((file) => {
              const content = sanitizeForScript(file.content).slice(0, CHAT_SCRIPT_CODE_LIMIT);
              budget -= content.length;
              return budget >= 0 ? [{ name: String(file.name).slice(0, 80), content }] : [];
            }),
          }
        : {}),
    };
    const configSetId = input.modelConfigSetId?.trim();
    const runtimeConfig = configSetId
      ? ((await resolveModelRuntimeConfigForAutomation(configSetId)) ?? undefined)
      : undefined;
    const controller = new AbortController();
    if (input.progressId) running.set(input.progressId, controller);
    try {
      return await requireScripts().generateDraft(input, generator, {
        runtimeConfig,
        signal: controller.signal,
        onProgress: input.progressId
          ? (progress) => {
              if (!event.sender.isDestroyed())
                event.sender.send('automation.scripts.generateProgress', {
                  progressId: input.progressId,
                  ...progress,
                });
            }
          : undefined,
      });
    } finally {
      if (input.progressId) running.delete(input.progressId);
    }
  });
}
