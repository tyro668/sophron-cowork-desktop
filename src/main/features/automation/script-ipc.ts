import { shell } from 'electron';
import { handleIpc } from '../../ipc-handle';
import { appContext } from '../../app/context';
import { configStore } from '../../config/config-store';
import {
  resolveAppConfigForAuth,
  resolveModelRuntimeConfigForAutomation,
} from '../../app/runtime-config';
import { createAgentScriptFilesGenerator } from '../../automation/script-packages/generator';
import type {
  ScriptGenerateDraftInput,
  ScriptPackageEditorState,
} from '../../../shared/automation/script-package';
import type { ScriptRunTarget } from '../../automation/script-packages/service';

function requireScripts() {
  if (!appContext.scriptPackages) throw new Error('Script packages are not initialized');
  return appContext.scriptPackages;
}

const generator = createAgentScriptFilesGenerator(() =>
  resolveAppConfigForAuth(configStore.getAll())
);

/** Running 规则生成 / AI 修复 agents by progressId, for 取消. */
const running = new Map<string, AbortController>();

export function registerScriptPackageIpc(): void {
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
  handleIpc('automation.scripts.generateDraft', async (event, input: ScriptGenerateDraftInput) => {
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
