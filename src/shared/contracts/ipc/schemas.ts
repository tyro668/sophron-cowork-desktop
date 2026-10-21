/**
 * Runtime schemas for IPC inputs. TypeScript types describe intent; these
 * zod schemas enforce it at the process boundary — every payload arriving via
 * `ipcRenderer.invoke`/`ipcRenderer.send` is validated before a handler runs.
 *
 * Schemas are intentionally "loose" (z.looseObject) at the top level so that
 * forward-compatible extra fields are preserved rather than stripped.
 */
import { z } from 'zod';
import {
  automationTableBindingsSchema,
  automationTableRefSchema,
  automationTablePolicyPatchSchema,
} from '../../automation/table-bindings';

const str = z.string();
const strOpt = str.optional();
const strNullish = str.nullish();
const bool = z.boolean();
const boolOpt = bool.optional();
const num = z.number();
const numOpt = num.optional();
const numNullish = num.nullish();
const obj = z.looseObject({});
const objOpt = obj.optional();

const providerType = z.enum([
  'openrouter',
  'anthropic',
  'custom',
  'openai',
  'openai-codex',
  'deepseek',
  'moonshot',
  'aliyun',
  'zai',
  'sophron',
  'gemini',
  'ollama',
]);
const customProtocol = z.enum(['anthropic', 'openai', 'gemini']);
const channelType = z.enum([
  'feishu',
  'lark',
  'wechat',
  'wecom',
  'telegram',
  'dingtalk',
  'websocket',
  'slack',
]);
const controllableChannelType = z.enum(['feishu', 'lark', 'wechat', 'dingtalk', 'wecom']);
const rawTableSourceKind = z.enum(['excel', 'csv', 'folder', 'cloud']);
const memoryItemStatus = z.enum(['active', 'pending', 'rejected', 'archived']);

const contentBlock = z.looseObject({ type: str }).superRefine((value, ctx) => {
  if (value.type !== 'data_pipeline_request') return;
  const parsed = dataPipelineAuthoringRequestSchema.safeParse(value.request);
  if (!parsed.success)
    ctx.addIssue({ code: 'custom', message: 'Invalid data pipeline authoring request' });
});

// ---------------------------------------------------------------------------
// client-event / client-invoke payload (ClientEvent union)
// ---------------------------------------------------------------------------
const dataPipelineAuthoringRequestSchema = z.lazy(() =>
  z.object({
    id: z.string().min(1),
    source: z.looseObject({ location: z.enum(['local', 'cloud']), tableId: z.string().min(1) }),
    output: z
      .looseObject({
        location: z.enum(['local', 'cloud']),
        writeMode: z.enum(['create', 'replace']),
      })
      .optional(),
    reusePipelineId: strNullish,
    startFromNodeId: strNullish,
    workflow: dataWorkflowSaveInput.nullish(),
  })
);
const sessionStartPayload = z.looseObject({
  title: str,
  prompt: str,
  cwd: strOpt,
  allowedTools: z.array(str).optional(),
  permissionPolicy: z.enum(['default', 'auto_review', 'full_access']).optional(),
  content: z.array(contentBlock).optional(),
  memoryEnabled: boolOpt,
  selectedSkillNames: z.array(str).optional(),
});
const sessionContinuePayload = z.looseObject({
  sessionId: str,
  prompt: str,
  permissionPolicy: z.enum(['default', 'auto_review', 'full_access']).optional(),
  content: z.array(contentBlock).optional(),
  selectedSkillNames: z.array(str).optional(),
});

export const clientEventSchema = z.discriminatedUnion('type', [
  z.looseObject({ type: z.literal('session.start'), payload: sessionStartPayload }),
  z.looseObject({ type: z.literal('session.continue'), payload: sessionContinuePayload }),
  z.looseObject({ type: z.literal('session.stop'), payload: z.looseObject({ sessionId: str }) }),
  z.looseObject({ type: z.literal('session.delete'), payload: z.looseObject({ sessionId: str }) }),
  z.looseObject({
    type: z.literal('session.rename'),
    payload: z.looseObject({ sessionId: str, title: str }),
  }),
  z.looseObject({
    type: z.literal('session.duplicate'),
    payload: z.looseObject({ sessionId: str, titleSuffix: str.optional() }),
  }),
  z.looseObject({
    type: z.literal('session.batchDelete'),
    payload: z.looseObject({ sessionIds: z.array(str) }),
  }),
  z.looseObject({ type: z.literal('session.list'), payload: obj }),
  z.looseObject({
    type: z.literal('session.getMessages'),
    payload: z.looseObject({ sessionId: str }),
  }),
  z.looseObject({
    type: z.literal('session.getTraceSteps'),
    payload: z.looseObject({ sessionId: str }),
  }),
  z.looseObject({
    type: z.literal('project.rename'),
    payload: z.looseObject({ projectId: str, name: str.nullable() }),
  }),
  z.looseObject({
    type: z.literal('project.renameByCwd'),
    payload: z.looseObject({ cwd: str, name: str.nullable() }),
  }),
  z.looseObject({
    type: z.literal('project.delete'),
    payload: z.looseObject({ projectId: str }),
  }),
  z.looseObject({
    type: z.literal('permission.response'),
    payload: z.looseObject({
      toolUseId: str,
      result: z.enum(['allow', 'deny', 'allow_always']),
    }),
  }),
  z.looseObject({
    type: z.literal('sudo.password.response'),
    payload: z.looseObject({ toolUseId: str, password: str.nullable() }),
  }),
  z.looseObject({
    type: z.literal('settings.update'),
    payload: z.record(z.string(), z.unknown()),
  }),
  z.looseObject({ type: z.literal('folder.select'), payload: obj }),
  z.looseObject({ type: z.literal('workdir.get'), payload: obj }),
  z.looseObject({
    type: z.literal('workdir.set'),
    payload: z.looseObject({ path: str, sessionId: strOpt }),
  }),
  z.looseObject({
    type: z.literal('workdir.select'),
    payload: z.looseObject({ sessionId: strOpt, currentPath: strOpt }),
  }),
]);

// ---------------------------------------------------------------------------
// Shared payload schemas
// ---------------------------------------------------------------------------
const appConfigUpdate = z.looseObject({
  provider: providerType.optional(),
  apiKey: strOpt,
  baseUrl: strOpt,
  customProtocol: customProtocol.optional(),
  model: strOpt,
  builtinLlmModel: strOpt,
  contextWindow: numOpt,
  maxTokens: numOpt,
  activeProfileKey: strOpt,
  profiles: z.record(str, obj).optional(),
  activeConfigSetId: strOpt,
  configSets: z.array(obj).optional(),
  defaultWorkdir: strOpt,
  globalSkillsPath: strOpt,
  enableDevLogs: boolOpt,
  theme: z.enum(['dark', 'light', 'system']).optional(),
  accentTheme: z.enum(['mint', 'lake', 'lavender', 'orange', 'rose']).optional(),
  logoVariant: z.enum(['mark', 'fold']).optional(),
  permissionPolicy: z.enum(['default', 'auto_review', 'full_access']).optional(),
  sandboxEnabled: boolOpt,
  memoryEnabled: boolOpt,
  memoryRuntime: objOpt,
  personalAnalysis: objOpt,
  enableThinking: boolOpt,
  thinkingLevel: z.enum(['low', 'medium', 'high']).optional(),
  isConfigured: boolOpt,
});

const createSetPayload = z.looseObject({
  name: str,
  mode: z.enum(['blank', 'clone']),
  fromSetId: strOpt,
});

const apiTestInput = z.looseObject({
  provider: providerType,
  apiKey: str,
  baseUrl: strOpt,
  customProtocol: customProtocol.optional(),
  model: strOpt,
  useLiveRequest: boolOpt,
  verificationLevel: z.enum(['fast', 'deep']).optional(),
});

const diagnosticInput = z.looseObject({
  provider: providerType,
  apiKey: str,
  baseUrl: strOpt,
  customProtocol: customProtocol.optional(),
  model: strOpt,
  verificationLevel: z.enum(['fast', 'deep']).optional(),
});

const mcpServerConfig = z.looseObject({
  id: str,
  name: str,
  type: z.enum(['stdio', 'sse', 'streamable-http']),
  command: strOpt,
  args: z.array(str).optional(),
  env: z.record(str, str).optional(),
  cwd: strOpt,
  url: strOpt,
  headers: z.record(str, str).optional(),
  enabled: bool,
});

const dmPolicy = z.looseObject({
  policy: z.enum(['open', 'pairing', 'allowlist']),
  allowFrom: z.array(str).optional(),
});
const channelGroups = z
  .record(str, z.looseObject({ requireMention: bool, allowFrom: z.array(str).optional() }))
  .optional();
const defaultGroupSettings = z.looseObject({ requireMention: bool }).optional();

const gatewayConfigPatch = z.looseObject({
  enabled: boolOpt,
  port: numOpt,
  bind: z.enum(['127.0.0.1', '0.0.0.0']).optional(),
  auth: objOpt,
  tunnel: objOpt,
  defaultWorkingDirectory: strOpt,
  autoApproveSafeTools: boolOpt,
});

const feishuChannelConfig = z.looseObject({
  type: z.enum(['feishu', 'lark']),
  enabled: boolOpt,
  appId: str,
  appSecret: str,
  verificationToken: strOpt,
  encryptKey: strOpt,
  useWebSocket: boolOpt,
  dm: dmPolicy,
  groups: channelGroups,
  defaultGroupSettings,
});
const dingtalkChannelConfig = z.looseObject({
  type: z.literal('dingtalk'),
  enabled: boolOpt,
  receiveMode: z.enum(['stream', 'webhook']).optional(),
  appKey: str,
  appSecret: str,
  robotCode: strOpt,
  dm: dmPolicy,
  groups: channelGroups,
  defaultGroupSettings,
});
const wecomChannelConfig = z.looseObject({
  type: z.literal('wecom'),
  enabled: boolOpt,
  receiveMode: z.enum(['websocket', 'webhook']).optional(),
  botId: str,
  secret: str,
  wsUrl: strOpt,
  webhookToken: strOpt,
  webhookEncodingAESKey: strOpt,
  dm: dmPolicy,
  groups: channelGroups,
  defaultGroupSettings,
});

const memoryEntryUpdate = z.looseObject({
  key: strOpt,
  value: strOpt,
  confidence: numOpt,
  status: memoryItemStatus.optional(),
});

const dataRunPipelineInput = z.looseObject({
  sourcePath: strNullish,
  workflow: z.looseObject({ nodes: z.array(obj), edges: z.array(obj) }).nullish(),
  outputMode: z.enum(['persisted', 'temporary']).optional(),
});

const dataWorkflowSaveInput = z.looseObject({
  nodes: z.array(z.looseObject({ id: str, type: str, label: str, x: num, y: num, config: objOpt })),
  edges: z.array(
    z.looseObject({
      id: str,
      sourceNodeId: str,
      targetNodeId: str,
      sourceHandle: strNullish,
      targetHandle: strNullish,
    })
  ),
});

const dataPreviewWorkflowNodeInput = z.looseObject({
  pipelineId: str,
  nodeId: str,
  nodeType: str,
  nodeConfig: objOpt,
  workflow: dataWorkflowSaveInput.nullish(),
  limit: numOpt,
  offset: numOpt,
});

const personalAnalysisConnection = z.looseObject({
  apiOrigin: strOpt,
  apiKey: strOpt,
  accessToken: strOpt,
  connectionMode: z.enum(['account', 'apiKey']).optional(),
});

const scheduleConfig = z
  .discriminatedUnion('kind', [
    z.looseObject({ kind: z.literal('daily'), times: z.array(str) }),
    z.looseObject({
      kind: z.literal('weekly'),
      weekdays: z.array(num),
      times: z.array(str),
    }),
    z.looseObject({
      kind: z.literal('monthly'),
      daysOfMonth: z.array(num),
      includeLastDay: boolOpt,
      times: z.array(str),
    }),
  ])
  .nullish();

const scheduleAutomationConfig = z
  .looseObject({
    actionKind: z.enum(['conversation', 'data_pipeline']),
    dataPipelineId: strNullish,
    dataPipelineName: strNullish,
    delivery: z.looseObject({
      enabled: bool,
      artifactPolicy: z.enum(['summary', 'links', 'files']),
      recipients: z.array(
        z.looseObject({
          id: str,
          label: str,
          channel: z.enum(['feishu', 'slack', 'webhook', 'email']),
          target: str,
          enabled: bool,
        })
      ),
    }),
  })
  .nullish();

// ---------------------------------------------------------------------------
// Per-channel positional argument schemas (index i validates args[i]; extra
// args pass through unvalidated for variadic channels).
// ---------------------------------------------------------------------------
export const IPC_INPUT_SCHEMAS: Record<string, readonly z.ZodType[]> = {
  // system / update / auth
  'get-version': [],
  'system.getTheme': [],
  'update.getState': [],
  'update.checkAndInstall': [],
  'auth.getStatus': [],
  'auth.login': [],
  'auth.cancelLogin': [],
  'auth.logout': [],
  // shell / dialog / reports / artifacts
  'shell.openExternal': [str],
  'shell.showItemInFolder': [str, strOpt],
  'shell.openPath': [str, strOpt],
  'reports.openGeneratedReport': [str, strOpt],
  'dialog.selectFiles': [],
  'dialog.selectRawTableSource': [rawTableSourceKind.exclude(['cloud']).optional()],
  'artifacts.listRecentFiles': [str, num, numOpt],
  // config
  'config.get': [],
  'config.getPresets': [],
  'config.save': [appConfigUpdate],
  'config.createSet': [createSetPayload],
  'config.renameSet': [z.looseObject({ id: str, name: str })],
  'config.deleteSet': [z.looseObject({ id: str })],
  'config.switchSet': [z.looseObject({ id: str })],
  'config.updateSet': [z.looseObject({ id: str, updates: appConfigUpdate })],
  'config.selectBuiltinModel': [z.looseObject({ model: str })],
  'config.isConfigured': [],
  'config.test': [apiTestInput],
  'config.listModels': [z.looseObject({ provider: providerType, apiKey: str, baseUrl: strOpt })],
  'config.diagnose': [diagnosticInput],
  'config.discover-local': [z.looseObject({ baseUrl: strOpt }).optional()],
  'config.codexAuthStatus': [],
  'config.codexImportCli': [],
  'config.codexLogin': [],
  'config.codexLoginCode': [z.looseObject({ requestId: str, code: str })],
  'config.codexLogout': [],
  'config.listPersonalAnalysisDatasources': [personalAnalysisConnection],
  // client event hub
  'client-invoke': [clientEventSchema],
  // mcp
  'mcp.getServers': [],
  'mcp.getServer': [str],
  'mcp.saveServer': [mcpServerConfig],
  'mcp.deleteServer': [str],
  'mcp.getTools': [],
  'mcp.getServerStatus': [],
  'mcp.getPresets': [],
  // skills
  'skills.getAll': [],
  'skills.getUsageCounts': [numOpt],
  'skills.install': [str],
  'skills.installFromSkillHub': [str],
  'skills.delete': [str],
  'skills.setEnabled': [str, bool],
  'skills.validate': [str],
  'skills.getStoragePath': [],
  'skills.setStoragePath': [str, boolOpt],
  'skills.openStoragePath': [],
  'skills.openSkillPath': [str],
  // plugins
  'plugins.listInstalled': [],
  'plugins.listCatalog': [],
  'plugins.install': [str],
  'plugins.setEnabled': [str, bool],
  'plugins.setComponentEnabled': [
    str,
    z.enum(['skills', 'commands', 'agents', 'hooks', 'mcp']),
    bool,
  ],
  'plugins.uninstall': [str],
  // sandbox
  'sandbox.getStatus': [],
  'sandbox.checkWSL': [],
  'sandbox.installNodeInWSL': [str],
  'sandbox.installPythonInWSL': [str],
  'sandbox.checkLima': [],
  'sandbox.createLimaInstance': [],
  'sandbox.startLimaInstance': [],
  'sandbox.stopLimaInstance': [],
  'sandbox.installNodeInLima': [],
  'sandbox.installPythonInLima': [],
  'sandbox.retryLimaSetup': [],
  'sandbox.retrySetup': [],
  // logs
  'logs.getPath': [],
  'logs.getDirectory': [],
  'logs.getAll': [],
  'logs.export': [],
  'logs.open': [],
  'logs.clear': [],
  'logs.setEnabled': [bool],
  'logs.isEnabled': [],
  'logs.write': [z.enum(['info', 'warn', 'error'])],
  // remote control
  'remote.getConfig': [],
  'remote.getStatus': [],
  'remote.setEnabled': [bool],
  'remote.setChannelEnabled': [controllableChannelType, bool],
  'remote.updateGatewayConfig': [gatewayConfigPatch],
  'remote.beginQrSetup': [
    z.string().uuid(),
    z.enum(['feishu', 'lark', 'wechat', 'dingtalk', 'wecom']),
  ],
  'remote.getQrSetup': [z.string().uuid()],
  'remote.submitQrSetupCode': [z.string().uuid(), z.string().regex(/^\d{4,12}$/)],
  'remote.cancelQrSetup': [z.string().uuid()],
  'remote.updateFeishuConfig': [feishuChannelConfig],
  'remote.updateDingtalkConfig': [dingtalkChannelConfig, gatewayConfigPatch.optional()],
  'remote.updateWecomConfig': [wecomChannelConfig, gatewayConfigPatch.optional()],
  'remote.getPairedUsers': [],
  'remote.getPendingPairings': [],
  'remote.approvePairing': [channelType, str],
  'remote.revokePairing': [channelType, str],
  'remote.rejectPairing': [channelType, str],
  'remote.getRemoteSessions': [],
  'remote.clearRemoteSession': [str],
  'remote.getTunnelStatus': [],
  'remote.getWebhookUrl': [channelType.optional()],
  'remote.restart': [],
  // automation
  'automation.list': [
    z
      .looseObject({
        query: strOpt,
        status: strOpt,
        projectId: strNullish,
        limit: numOpt,
        offset: numOpt,
        groupId: strNullish,
        perGroupLimit: numOpt,
      })
      .optional(),
  ],
  'automation.get': [str],
  'automation.tableAssociation.replace': [
    automationTableRefSchema,
    z.string().min(1),
    z.string().min(1),
  ],
  'automation.tablePolicy.get': [automationTableRefSchema],
  'automation.tablePolicy.set': [automationTableRefSchema, automationTablePolicyPatchSchema],
  'automation.create': [
    z.looseObject({
      name: str,
      trigger: obj,
      actionGraph: obj,
      tableBindings: automationTableBindingsSchema.optional(),
      outputBindings: z
        .array(
          z.object({
            resultTableId: z.string().trim().min(1),
            runOnChange: bool,
            runOnTrigger: bool.optional(),
          })
        )
        .optional(),
    }),
  ],
  'automation.update': [
    str,
    z.looseObject({
      tableBindings: automationTableBindingsSchema.optional(),
      outputBindings: z
        .array(
          z.object({
            resultTableId: z.string().trim().min(1),
            runOnChange: bool,
            runOnTrigger: bool.optional(),
          })
        )
        .optional(),
    }),
  ],
  'automation.delete': [str],
  'automation.setEnabled': [str, bool],
  'automation.pause': [str],
  'automation.resume': [str],
  'automation.runNow': [str],
  'automation.runs.list': [str, objOpt],
  'automation.artifacts.list': [str],
  'automation.actions.listDefinitions': [],
  'automation.groups.list': [],
  'automation.groups.create': [z.looseObject({ name: str })],
  'automation.groups.rename': [z.looseObject({ id: str, name: str })],
  'automation.groups.delete': [str],
  'automation.groups.assign': [z.looseObject({ ids: z.array(str), groupId: str.nullable() })],
  // schedule
  'schedule.list': [],
  'schedule.create': [
    z.looseObject({
      title: strOpt,
      prompt: str,
      cwd: str,
      automationConfig: scheduleAutomationConfig,
      runAt: num,
      nextRunAt: numNullish,
      scheduleConfig: scheduleConfig,
      repeatEvery: numNullish,
      repeatUnit: z.enum(['minute', 'hour', 'day']).nullish(),
      enabled: boolOpt,
    }),
  ],
  'schedule.update': [
    str,
    z.looseObject({
      title: strOpt,
      prompt: strOpt,
      cwd: strOpt,
      automationConfig: scheduleAutomationConfig,
      runAt: numOpt,
      nextRunAt: numNullish,
      scheduleConfig: scheduleConfig,
      repeatEvery: numNullish,
      repeatUnit: z.enum(['minute', 'hour', 'day']).nullish(),
      enabled: boolOpt,
      lastRunAt: numNullish,
      lastRunSessionId: strNullish,
      lastError: strNullish,
    }),
  ],
  'schedule.delete': [str],
  'schedule.toggle': [str, bool],
  'schedule.runNow': [str],
  // memory
  'memory.getOverview': [strOpt],
  'memory.search': [
    z.looseObject({
      query: str,
      cwd: strOpt,
      sourceWorkspace: strNullish,
      scope: z.enum(['workspace', 'global', 'all']).optional(),
      limit: numOpt,
    }),
  ],
  'memory.read': [str],
  'memory.listCoreEntries': [],
  'memory.updateCoreEntry': [str, memoryEntryUpdate],
  'memory.deleteCoreEntry': [str],
  'memory.listProjectEntries': [strNullish],
  'memory.updateProjectEntry': [str, memoryEntryUpdate],
  'memory.deleteProjectEntry': [str],
  'memory.rebuildWorkspace': [str],
  'memory.clearWorkspace': [str],
  'memory.clearCoreMemory': [],
  'memory.rebuildAll': [],
  'memory.listFiles': [],
  'memory.readFile': [str],
  'memory.inspectSession': [str, strOpt],
  'memory.listInjections': [numOpt],
  'memory.setEnabled': [bool],
  // data workspace
  'data.getDashboard': [
    z
      .looseObject({
        query: strOpt,
        includeSummary: boolOpt,
        includePipelines: boolOpt,
        includeRawTables: boolOpt,
        includeResultTables: boolOpt,
        pipelineOffset: numOpt,
        pipelineLimit: numOpt,
        rawTableOffset: numOpt,
        rawTableLimit: numOpt,
        outputOffset: numOpt,
        outputLimit: numOpt,
        rawTableSourceKind: strOpt,
        pipelineGroupId: strNullish,
        rawTableGroupId: strNullish,
        outputGroupId: strNullish,
        pipelinePerGroupLimit: numOpt,
        rawTablePerGroupLimit: numOpt,
        outputPerGroupLimit: numOpt,
      })
      .optional(),
  ],
  'data.getPipeline': [str],
  'data.createPipeline': [
    z.looseObject({
      name: str,
      sourcePath: strNullish,
      sourceRawTableId: strNullish,
      resultTableId: strNullish,
    }),
  ],
  'data.updatePipeline': [z.looseObject({ id: str, name: strOpt })],
  'data.listGroups': [z.enum(['pipeline', 'raw', 'result'])],
  'data.createGroup': [z.looseObject({ scope: z.enum(['pipeline', 'raw', 'result']), name: str })],
  'data.renameGroup': [z.looseObject({ id: str, name: str })],
  'data.deleteGroup': [str],
  'data.assignGroup': [
    z.looseObject({
      scope: z.enum(['pipeline', 'raw', 'result']),
      ids: z.array(str),
      groupId: strNullish,
    }),
  ],
  'data.runPipeline': [str, dataRunPipelineInput.optional()],
  'data.runPipelineWithDiagnostics': [str, dataRunPipelineInput.optional()],
  'data.getPipelineNodeStats': [str],
  'data.listPipelineRuns': [str, numOpt],
  'data.getPipelineRunNodeStats': [str, str],
  'data.getPipelineWorkflow': [str],
  'data.savePipelineWorkflow': [str, dataWorkflowSaveInput],
  'data.validatePipelineWorkflowPlan': [str, dataWorkflowSaveInput],
  'data.importRawTable': [
    z.looseObject({
      filePath: str,
      name: strOpt,
      sourceKind: rawTableSourceKind.optional(),
      config: objOpt,
    }),
  ],
  'data.getRawTable': [str],
  'data.updateRawTable': [
    z.looseObject({
      id: str,
      filePath: strOpt,
      name: strOpt,
      sourceKind: rawTableSourceKind.optional(),
      config: objOpt,
    }),
  ],
  'data.getResultTable': [str],
  'data.createResultTable': [z.looseObject({ name: strOpt }).optional()],
  'data.updateResultTable': [
    z.looseObject({ id: str, name: strOpt, sourceRawTableId: strNullish }),
  ],
  'data.previewRawTableSource': [
    z.looseObject({
      filePath: str,
      sourceKind: rawTableSourceKind,
      config: obj,
      limit: numOpt,
      offset: numOpt,
    }),
  ],
  'data.previewRawTable': [z.looseObject({ id: str, limit: numOpt, offset: numOpt })],
  'data.exportTable': [
    z.looseObject({
      tableKind: z.enum(['raw', 'result']),
      id: str,
      format: z.enum(['csv', 'xlsx']),
    }),
  ],
  'data.previewWorkflowNode': [dataPreviewWorkflowNodeInput],
  'data.getWorkflowNodeColumns': [dataPreviewWorkflowNodeInput],
  'data.getWorkflowNodeColumnTypes': [dataPreviewWorkflowNodeInput],
  'data.getWorkflowNodeColumnValues': [dataPreviewWorkflowNodeInput.extend({ column: str })],
  'data.getWorkflowNodeRowCount': [dataPreviewWorkflowNodeInput],
  'data.summarizeRawTableSource': [
    z.looseObject({
      sourcePath: str,
      sourceKind: rawTableSourceKind.optional(),
      config: objOpt,
      maxFiles: numOpt,
      maxSheetsPerFile: numOpt,
      maxRowsPerSheet: numOpt,
      maxColumnsPerRow: numOpt,
    }),
  ],
  'data.generateRawTableNormalizerDraft': [
    z.looseObject({
      name: str,
      sourcePath: str,
      rulePrompt: str,
      artifactId: strNullish,
      description: strNullish,
      sourceKind: rawTableSourceKind.optional(),
      config: objOpt,
      selectedSkillNames: z.array(str).optional(),
      modelConfigSetId: strNullish,
      model: strNullish,
      primaryLanguage: z.enum(['python', 'node']).optional(),
      progressId: strOpt,
    }),
  ],
  'data.previewRawTableNormalizerVersion': [
    z.looseObject({
      versionId: str,
      sourcePath: str,
      sourceKind: rawTableSourceKind.optional(),
      config: objOpt,
      prepareDependencies: boolOpt,
      limit: numOpt,
      offset: numOpt,
    }),
  ],
  'data.publishRawTableNormalizerVersion': [z.looseObject({ versionId: str })],
  'data.deleteRawTableNormalizerVersion': [z.looseObject({ versionId: str })],
  'data.listRawTableNormalizerVersions': [z.looseObject({ artifactId: str })],
  'data.deletePipeline': [str],
  'data.deleteRawTable': [str],
  'data.listCloudSpaces': [personalAnalysisConnection.optional()],
  'data.listCloudProjects': [personalAnalysisConnection.extend({ spaceId: str })],
  'data.listCloudTables': [personalAnalysisConnection.extend({ spaceId: str, projectId: str })],
  'data.searchCloudTables': [personalAnalysisConnection.extend({ keyword: str })],
  'data.previewCloudTable': [
    personalAnalysisConnection.extend({ tableId: str, limit: numOpt, offset: numOpt }),
  ],
  'data.importCloudRawTable': [
    personalAnalysisConnection.extend({
      rawTableId: strOpt,
      tableId: str,
      spaceId: strOpt,
      projectId: strOpt,
      spaceName: strOpt,
      projectName: strOpt,
      name: strOpt,
      previewRows: numOpt,
    }),
  ],
  'data.refreshCloudRawTable': [
    personalAnalysisConnection.extend({
      rawTableId: str,
    }),
  ],
  'data.uploadDataTableToCloud': [
    personalAnalysisConnection.extend({
      tableKind: z.enum(['raw', 'result']),
      id: str,
      writeMode: z.enum(['CREATE', 'REPLACE']),
      datasourceId: strOpt,
      folderId: strOpt,
      projectId: strOpt,
      spaceId: strOpt,
      tableId: strOpt,
      tableName: strOpt,
      fileName: strOpt,
      maxRows: numOpt,
      waitForDone: boolOpt,
    }),
  ],
  'data.listCloudDriveFiles': [
    personalAnalysisConnection.extend({
      spaceId: str,
      projectId: str,
      keyword: strOpt,
      fileType: z.enum(['csv', 'excel']).optional(),
      page: numOpt,
      pageSize: numOpt,
    }),
  ],
  'data.previewCloudDriveFile': [
    personalAnalysisConnection.extend({
      spaceId: str,
      projectId: str,
      fileId: str,
      sheetName: strOpt,
    }),
  ],
};
