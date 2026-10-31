import { configStore } from '../../config/config-store';
import { resolveAppConfigForAuth } from '../../app/runtime-config';
import { createAgentScriptFilesGenerator } from '../../automation/script-packages/generator';

/** The one script generation agent: editor 规则生成 / AI 修复, 对话转成脚本 and automation repairs. */
export const scriptFilesGenerator = createAgentScriptFilesGenerator(() =>
  resolveAppConfigForAuth(configStore.getAll())
);
