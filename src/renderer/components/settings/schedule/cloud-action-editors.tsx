import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Cloud,
  Database,
  Loader2,
  Save,
  Search,
  UploadCloud,
  Wand2,
} from 'lucide-react';
import type {
  AppConfig,
  AutomationActionNode,
  DataAnalyzeTaskRequirementResult,
  DataDashboard,
  DataGenerateTaskFromRequirementInput,
  DesktopAuthStatus,
  PersonalAnalysisProject,
  PersonalAnalysisSpace,
  PersonalAnalysisTable,
} from '../../../types';
import { useAppStore } from '../../../store';
import { GlassSelect } from '../../GlassSelect';
import {
  CLOUD_TARGET_TABLE_PAGE_SIZE,
  DATA_PROCESS_TASK_CONFIG_KEY,
  type CloudAutomationSourceTable,
  type CloudAutomationWriteMode,
  type CloudConnectionPayload,
  type CloudTableAutomationConfig,
  type DataProcessLocation,
  getOutputLocation,
  getSourceLocation,
  isElectron,
} from './types';
import { buildCloudAutomationPrompt, createGeneratedCloudTableProcessNode } from './model';
import {
  AutomationPromptPermissionFields,
  ConfigRow,
  LocalTableSelect,
  SegmentedControl,
  createLlmUsageTraceId,
  getStashedDataProcessConfig,
} from './editor-controls';

export function CloudTableProcessActionEditor({
  node,
  config,
  inputTables,
  outputTables,
  appConfig,
  onGeneratedTaskSuccess,
  onChange,
  tr,
}: {
  node: AutomationActionNode;
  config: CloudTableAutomationConfig;
  inputTables: DataDashboard['datasets'];
  outputTables: DataDashboard['outputTables'];
  appConfig: AppConfig | null;
  onChange: (node: AutomationActionNode) => void;
  onGeneratedTaskSuccess: (workflowDslAvailable: boolean) => void;
  tr: (key: string, fallback: string) => string;
}) {
  const sourceLocation = getSourceLocation(config);
  const outputLocation = getOutputLocation(config);
  const desktopAuthStatus = useAppStore((state) => state.desktopAuthStatus);
  const cloudConnection = useMemo(
    () => getCloudConnectionPayload(appConfig, desktopAuthStatus),
    [appConfig, desktopAuthStatus]
  );
  const conversationSelectedSkillNames = Array.isArray(node.config.selectedSkillNames)
    ? node.config.selectedSkillNames.filter((name): name is string => typeof name === 'string')
    : [];
  const selectedModelConfigSetId =
    typeof node.config.modelConfigSetId === 'string' && node.config.modelConfigSetId.trim()
      ? node.config.modelConfigSetId
      : appConfig?.activeConfigSetId;
  const [isGeneratingTask, setIsGeneratingTask] = useState(false);
  const [isAnalyzingTask, setIsAnalyzingTask] = useState(false);
  const [requirementAnalysis, setRequirementAnalysis] =
    useState<DataAnalyzeTaskRequirementResult | null>(null);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const usageTraceIdRef = useRef(createLlmUsageTraceId());
  const resetUsageTraceId = () => {
    usageTraceIdRef.current = createLlmUsageTraceId();
  };

  const updateConfig = (
    next: CloudTableAutomationConfig,
    nodeConfigUpdates: Record<string, unknown> = {}
  ) => {
    onChange({
      ...node,
      label: '',
      config: {
        ...node.config,
        prompt: buildCloudAutomationPrompt(next),
        cloudAutomation: next,
        ...nodeConfigUpdates,
      },
    });
  };
  const updateSource = (source: CloudAutomationSourceTable) => {
    setRequirementAnalysis(null);
    resetUsageTraceId();
    const previousDefaultName = `${config.source.tableName || 'cloud_table'}_processed`;
    const nextDefaultName = `${source.tableName || 'cloud_table'}_processed`;
    updateConfig({
      ...config,
      source,
      output: {
        ...config.output,
        spaceId: config.output.spaceId || source.spaceId,
        projectId: config.output.projectId || source.projectId,
        datasourceId: config.output.datasourceId || source.datasourceId,
        folderId: config.output.folderId || source.folderId,
        tableName:
          !config.output.tableName || config.output.tableName === previousDefaultName
            ? nextDefaultName
            : config.output.tableName,
        targetTableId:
          config.output.writeMode === 'replace' &&
          config.output.targetTableId === config.source.tableId
            ? source.tableId
            : config.output.targetTableId,
      },
    });
  };
  const updateSourceLocation = (location: DataProcessLocation) => {
    if (location === sourceLocation) return;
    updateSource({ location, tableId: '', tableName: '', columns: [], rowCount: null });
  };
  const updateLocalSource = (datasetId: string) => {
    const dataset = inputTables.find((table) => table.id === datasetId);
    updateSource({
      location: 'local',
      tableId: datasetId,
      tableName: dataset?.name ?? datasetId,
      columns: [],
      rowCount: dataset?.rowCount ?? null,
    });
  };
  const updateOutputLocation = (location: DataProcessLocation) => {
    if (location === outputLocation) return;
    // Target tables differ between cloud and local, so clear the target on switch.
    updateConfig({ ...config, output: { ...config.output, location, targetTableId: '' } });
  };
  const buildGenerationInput = (
    processRequirement = config.processRequirement
  ): DataGenerateTaskFromRequirementInput => {
    const reusableTaskConfig = getStashedDataProcessConfig(
      node.config,
      DATA_PROCESS_TASK_CONFIG_KEY
    );
    const reusableTaskSource =
      reusableTaskConfig?.source &&
      typeof reusableTaskConfig.source === 'object' &&
      !Array.isArray(reusableTaskConfig.source)
        ? (reusableTaskConfig.source as Record<string, unknown>)
        : null;
    const canReuseGeneratedTask =
      reusableTaskSource?.location === sourceLocation &&
      reusableTaskSource.tableId === config.source.tableId;
    const reusableTaskOutput =
      reusableTaskConfig?.output &&
      typeof reusableTaskConfig.output === 'object' &&
      !Array.isArray(reusableTaskConfig.output)
        ? (reusableTaskConfig.output as Record<string, unknown>)
        : null;
    const canReuseGeneratedOutputTable =
      canReuseGeneratedTask &&
      reusableTaskOutput?.tableName === config.output.tableName &&
      typeof reusableTaskOutput.localOutputTableId === 'string';
    return {
      usageTraceId: usageTraceIdRef.current,
      analysisId: requirementAnalysis?.analysisId,
      source: {
        location: sourceLocation,
        tableId: config.source.tableId,
        tableName: config.source.tableName,
        spaceId: config.source.spaceId,
        spaceName: config.source.spaceName,
        projectId: config.source.projectId,
        projectName: config.source.projectName,
        datasourceId: config.source.datasourceId,
        folderId: config.source.folderId,
        columnsSnapshot: normalizeAutomationColumns(config.source.columns),
        updatedAt: config.source.updatedAt,
        contentHash: config.source.contentHash,
      },
      processRequirement,
      output: {
        location: outputLocation,
        writeMode: config.output.writeMode,
        targetTableId: config.output.targetTableId || undefined,
        tableName: config.output.tableName,
        spaceId: config.output.spaceId || config.source.spaceId,
        projectId: config.output.projectId || config.source.projectId,
        datasourceId: config.output.datasourceId || config.source.datasourceId,
        folderId: config.output.folderId || config.source.folderId,
        localOutputTableId: canReuseGeneratedOutputTable
          ? String(reusableTaskOutput.localOutputTableId)
          : undefined,
      },
      modelConfigSetId: selectedModelConfigSetId,
      model: typeof node.config.model === 'string' ? node.config.model : undefined,
      reuseTaskId:
        canReuseGeneratedTask && typeof reusableTaskConfig?.taskId === 'string'
          ? reusableTaskConfig.taskId
          : undefined,
      currentVersion:
        canReuseGeneratedTask && typeof reusableTaskConfig?.generatedVersion === 'number'
          ? reusableTaskConfig.generatedVersion
          : undefined,
    };
  };
  const analyzeTask = async () => {
    if (!window.electronAPI?.data?.analyzeTaskRequirement) return;
    setIsAnalyzingTask(true);
    setRequirementAnalysis(null);
    setGenerationError(null);
    try {
      setRequirementAnalysis(
        await window.electronAPI.data.analyzeTaskRequirement(buildGenerationInput())
      );
    } catch (error) {
      setGenerationError(
        error instanceof Error
          ? error.message
          : tr('schedule.analyzeTaskFailed', '解析处理要求失败')
      );
    } finally {
      setIsAnalyzingTask(false);
    }
  };
  const generateTask = async (processRequirement = config.processRequirement) => {
    if (!window.electronAPI?.data?.generateTaskFromRequirement) return;
    setIsGeneratingTask(true);
    setGenerationError(null);
    try {
      const result = await window.electronAPI.data.generateTaskFromRequirement(
        buildGenerationInput(processRequirement)
      );
      onChange(createGeneratedCloudTableProcessNode(node, config, result));
      onGeneratedTaskSuccess(result.workflowDslAvailable);
      resetUsageTraceId();
    } catch (error) {
      setGenerationError(
        error instanceof Error
          ? error.message
          : tr('schedule.generateTaskFailed', '生成数据任务失败')
      );
    } finally {
      setIsGeneratingTask(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border-muted bg-bg-secondary/30 p-4">
        <div className="mb-4 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-[13px] font-semibold text-accent">
            {sourceLocation === 'local' ? (
              <Database className="h-4 w-4" />
            ) : (
              <Cloud className="h-4 w-4" />
            )}
            {sourceLocation === 'local'
              ? tr('schedule.localInputSection', '输入数据表')
              : tr('schedule.cloudInputTable', '输入云表')}
          </div>
          <SegmentedControl<DataProcessLocation>
            value={sourceLocation}
            options={[
              { value: 'cloud', label: tr('schedule.dataSourceCloud', '云端表') },
              { value: 'local', label: tr('schedule.dataSourceLocal', '本地表') },
            ]}
            onChange={updateSourceLocation}
          />
        </div>
        {sourceLocation === 'local' ? (
          <ConfigRow label={tr('schedule.localInputTable', '数据表')}>
            <LocalTableSelect
              value={config.source.tableId}
              tables={inputTables}
              placeholder={tr('schedule.inputTablePlaceholder', '选择输入表')}
              searchPlaceholder={tr('schedule.localInputSearchPlaceholder', '搜索数据表')}
              onChange={updateLocalSource}
            />
          </ConfigRow>
        ) : (
          <CloudSourceTableSelector
            source={config.source}
            connection={cloudConnection}
            onSourceChange={updateSource}
            tr={tr}
          />
        )}
      </div>

      <div className="rounded-lg border border-border-muted bg-bg-secondary/30 p-4">
        <div className="mb-4 flex items-center gap-2 text-[13px] font-semibold text-accent">
          <Wand2 className="h-4 w-4" />
          {tr('schedule.cloudProcessSection', '处理逻辑')}
        </div>
        <div className="space-y-4">
          <AutomationPromptPermissionFields
            value={config.processRequirement}
            onChange={(processRequirement) => {
              setRequirementAnalysis(null);
              resetUsageTraceId();
              updateConfig({
                ...config,
                processRequirement,
              });
            }}
            selectedSkillNames={conversationSelectedSkillNames}
            onSelectedSkillNamesChange={(selectedSkillNames) =>
              updateConfig(config, { selectedSkillNames })
            }
            onSkillSelectionCommit={({ value, selectedSkillNames }) => {
              setRequirementAnalysis(null);
              resetUsageTraceId();
              updateConfig(
                {
                  ...config,
                  processRequirement: value,
                },
                { selectedSkillNames }
              );
            }}
            appConfig={appConfig}
            selectedModelConfigSetId={selectedModelConfigSetId}
            onModelSelect={({ configSetId, model }) => {
              setRequirementAnalysis(null);
              resetUsageTraceId();
              updateConfig(config, {
                modelConfigSetId: configSetId,
                model,
              });
            }}
            label={tr('schedule.cloudProcessRequirement', '处理要求')}
            placeholder={
              sourceLocation === 'local'
                ? tr(
                    'schedule.dataProcessRequirementPlaceholder',
                    '描述你希望对这张表做的处理，例如：筛选 Profit > 0 的数据，保留指定字段，去重后按地区汇总销售额。'
                  )
                : tr(
                    'schedule.cloudProcessRequirementPlaceholder',
                    '描述你希望对云表做的处理，例如：筛选 Profit > 0 的数据，保留指定字段，去重后按地区汇总销售额。'
                  )
            }
            tr={tr}
          />
          <div className="flex flex-col items-stretch gap-2 sm:items-end">
            {requirementAnalysis && (
              <div className="w-full rounded-lg border border-border-muted bg-surface p-3">
                <div className="mb-2 text-[12px] font-semibold text-text-secondary">
                  {tr('schedule.requirementAnalysisResult', '需求解析结果')}
                </div>
                <div className="space-y-2">
                  {requirementAnalysis.items.map((item, index) => (
                    <div
                      key={`${item.requirement}-${index}`}
                      className="flex items-start gap-2 rounded-md bg-bg-secondary/50 px-2.5 py-2"
                    >
                      {item.status === 'supported' ? (
                        <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
                      ) : (
                        <AlertCircle
                          className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${
                            item.status === 'ambiguous' ? 'text-warning' : 'text-danger'
                          }`}
                        />
                      )}
                      <div className="min-w-0 text-[12px] leading-5">
                        <div className="text-text-secondary">{item.requirement}</div>
                        {item.reason && <div className="text-text-muted">{item.reason}</div>}
                      </div>
                      <span
                        className={`ml-auto shrink-0 text-[11px] font-medium ${
                          item.status === 'supported'
                            ? 'text-success'
                            : item.status === 'ambiguous'
                              ? 'text-warning'
                              : 'text-danger'
                        }`}
                      >
                        {item.status === 'supported'
                          ? tr('schedule.requirementSupported', '可生成')
                          : item.status === 'ambiguous'
                            ? tr('schedule.requirementAmbiguous', '需确认')
                            : tr('schedule.requirementUnsupported', '暂不支持')}
                      </span>
                    </div>
                  ))}
                </div>
                <div className="mt-3 flex flex-wrap justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setRequirementAnalysis(null)}
                    className="h-8 rounded-lg border border-border-muted px-3 text-[12px] font-medium text-text-secondary hover:bg-bg-secondary"
                  >
                    {tr('schedule.modifyRequirement', '返回修改')}
                  </button>
                  {requirementAnalysis.items.some((item) => item.status === 'supported') && (
                    <button
                      type="button"
                      disabled={isGeneratingTask}
                      onClick={() =>
                        void generateTask(
                          requirementAnalysis.items
                            .filter((item) => item.status === 'supported')
                            .map((item) => item.suggestedRequirement || item.requirement)
                            .join('\n')
                        )
                      }
                      className="h-8 rounded-lg border border-accent/40 bg-accent-muted px-3 text-[12px] font-semibold text-accent hover:bg-accent/15 disabled:opacity-50"
                    >
                      {requirementAnalysis.status === 'supported'
                        ? tr('schedule.confirmGenerateTask', '确认生成')
                        : tr('schedule.generateSupportedOnly', '仅生成可支持部分')}
                    </button>
                  )}
                </div>
              </div>
            )}
            {isAnalyzingTask && (
              <div
                className="flex w-full items-center gap-2 rounded-md border border-accent/20 bg-accent-muted px-2.5 py-2 text-[12px] leading-5 text-text-secondary"
                role="status"
                aria-live="polite"
              >
                <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-accent" />
                {tr('schedule.analyzingTaskRequirement', '正在拆解要求并匹配支持能力…')}
              </div>
            )}
            {isGeneratingTask && (
              <div
                className="flex w-full items-center gap-2 rounded-md border border-accent/20 bg-accent-muted px-2.5 py-2 text-[12px] leading-5 text-text-secondary"
                role="status"
                aria-live="polite"
              >
                <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-accent" />
                {tr(
                  'schedule.parsingAndValidatingTask',
                  '正在拆解处理要求，并校验字段、参数和任务逻辑…'
                )}
              </div>
            )}
            <button
              type="button"
              disabled={
                isAnalyzingTask ||
                isGeneratingTask ||
                Boolean(requirementAnalysis) ||
                !config.source.tableId.trim() ||
                !config.processRequirement.trim() ||
                (config.output.writeMode === 'replace' && !config.output.targetTableId.trim())
              }
              onClick={() => void analyzeTask()}
              className="inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-accent/40 bg-accent-muted px-3 text-xs font-semibold text-accent transition-colors hover:bg-accent/15 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
            >
              {isAnalyzingTask || isGeneratingTask ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Wand2 className="h-3.5 w-3.5" />
              )}
              {isAnalyzingTask
                ? tr('schedule.analyzingTask', '正在解析')
                : isGeneratingTask
                  ? tr('schedule.parsingAndGeneratingTask', '正在解析并生成')
                  : tr('schedule.parseAndGenerateDataTask', '解析并生成')}
            </button>
            {generationError && (
              <div className="w-full rounded-md border border-warning/25 bg-warning/10 px-2.5 py-2 text-[12px] leading-5 text-warning">
                {generationError}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-border-muted bg-bg-secondary/30 p-4">
        <div className="mb-4 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-[13px] font-semibold text-accent">
            {outputLocation === 'local' ? (
              <Save className="h-4 w-4" />
            ) : (
              <UploadCloud className="h-4 w-4" />
            )}
            {outputLocation === 'local'
              ? tr('schedule.localOutputSection', '输出到本地')
              : tr('schedule.cloudOutputSection', '输出到云分析')}
          </div>
          <SegmentedControl<DataProcessLocation>
            value={outputLocation}
            options={[
              { value: 'cloud', label: tr('schedule.dataOutputCloud', '云端表') },
              { value: 'local', label: tr('schedule.dataOutputLocal', '本地表') },
            ]}
            onChange={updateOutputLocation}
          />
        </div>
        <div className="space-y-3.5">
          <ConfigRow label={tr('schedule.cloudWriteMode', '写入方式')}>
            <GlassSelect
              value={config.output.writeMode}
              options={[
                { value: 'create', label: tr('schedule.cloudWriteCreate', '新建结果表') },
                { value: 'replace', label: tr('schedule.cloudWriteReplace', '覆盖指定表') },
              ]}
              onValueChange={(value) =>
                updateConfig({
                  ...config,
                  output: {
                    ...config.output,
                    writeMode: value as CloudAutomationWriteMode,
                    targetTableId:
                      value === 'replace'
                        ? config.output.targetTableId ||
                          (outputLocation === 'cloud' ? config.source.tableId : '')
                        : config.output.targetTableId,
                  },
                })
              }
              triggerClassName="h-9 w-full justify-between"
              contentClassName="w-[var(--radix-select-trigger-width)]"
            />
          </ConfigRow>
          {config.output.writeMode === 'replace' ? (
            outputLocation === 'local' ? (
              <ConfigRow label={tr('schedule.localTargetOutputTable', '目标输出表')}>
                <LocalTableSelect
                  value={config.output.targetTableId}
                  tables={outputTables}
                  placeholder={tr('schedule.outputTablePlaceholder', '选择输出表')}
                  searchPlaceholder={tr('schedule.localOutputSearchPlaceholder', '搜索输出表')}
                  onChange={(tableId) =>
                    updateConfig({
                      ...config,
                      output: { ...config.output, targetTableId: tableId },
                    })
                  }
                />
              </ConfigRow>
            ) : (
              <ConfigRow label={tr('schedule.cloudTargetTable', '目标表')}>
                <CloudReplaceTargetSelector
                  config={config}
                  connection={cloudConnection}
                  onTargetChange={(tableId) =>
                    updateConfig({
                      ...config,
                      output: { ...config.output, targetTableId: tableId },
                    })
                  }
                  tr={tr}
                />
              </ConfigRow>
            )
          ) : (
            <ConfigRow label={tr('schedule.cloudOutputTableName', '结果表名')}>
              <input
                value={config.output.tableName}
                onChange={(event) =>
                  updateConfig({
                    ...config,
                    output: { ...config.output, tableName: event.target.value },
                  })
                }
                className="input h-9 w-full text-xs"
              />
            </ConfigRow>
          )}
        </div>
      </div>
    </div>
  );
}

export function CloudSourceTableSelector({
  source,
  connection,
  onSourceChange,
  tr,
}: {
  source: CloudAutomationSourceTable;
  connection: CloudConnectionPayload;
  onSourceChange: (source: CloudAutomationSourceTable) => void;
  tr: (key: string, fallback: string) => string;
}) {
  const [spaces, setSpaces] = useState<PersonalAnalysisSpace[]>([]);
  const [projects, setProjects] = useState<PersonalAnalysisProject[]>([]);
  const [tables, setTables] = useState<PersonalAnalysisTable[]>([]);
  const [keyword, setKeyword] = useState('');
  const [loadingSpaces, setLoadingSpaces] = useState(false);
  const [loadingProjects, setLoadingProjects] = useState(false);
  const [loadingTables, setLoadingTables] = useState(false);
  const [spacesError, setSpacesError] = useState<string | null>(null);
  const [projectsError, setProjectsError] = useState<string | null>(null);
  const [tablesError, setTablesError] = useState<string | null>(null);
  const spacesRequestSeq = useRef(0);
  const projectsRequestSeq = useRef(0);
  const tablesRequestSeq = useRef(0);
  const canBrowseCloud = Boolean(connection.apiOrigin && isElectron && window.electronAPI?.data);
  const error = tablesError ?? projectsError ?? spacesError;

  useEffect(() => {
    if (!canBrowseCloud) {
      setSpaces([]);
      setLoadingSpaces(false);
      spacesRequestSeq.current += 1;
      return;
    }
    const requestId = ++spacesRequestSeq.current;
    setLoadingSpaces(true);
    setSpacesError(null);
    void window.electronAPI.data
      .listCloudSpaces(connection)
      .then((result) => {
        if (requestId !== spacesRequestSeq.current) return;
        setSpaces(result.spaces);
      })
      .catch((loadError) => {
        if (requestId !== spacesRequestSeq.current) return;
        setSpaces([]);
        setSpacesError(
          loadError instanceof Error
            ? loadError.message
            : tr('schedule.cloudCatalogLoadFailed', '加载云分析空间失败')
        );
      })
      .finally(() => {
        if (requestId === spacesRequestSeq.current) {
          setLoadingSpaces(false);
        }
      });
  }, [canBrowseCloud, connection, tr]);

  useEffect(() => {
    if (!canBrowseCloud || !source.spaceId) {
      setProjects([]);
      setLoadingProjects(false);
      setProjectsError(null);
      projectsRequestSeq.current += 1;
      return;
    }
    const requestId = ++projectsRequestSeq.current;
    setLoadingProjects(true);
    setProjectsError(null);
    void window.electronAPI.data
      .listCloudProjects({ ...connection, spaceId: source.spaceId })
      .then((result) => {
        if (requestId !== projectsRequestSeq.current) return;
        setProjects(result.projects);
      })
      .catch((loadError) => {
        if (requestId !== projectsRequestSeq.current) return;
        setProjects([]);
        setProjectsError(
          loadError instanceof Error
            ? loadError.message
            : tr('schedule.cloudProjectsLoadFailed', '加载云分析项目失败')
        );
      })
      .finally(() => {
        if (requestId === projectsRequestSeq.current) {
          setLoadingProjects(false);
        }
      });
  }, [canBrowseCloud, connection, source.spaceId, tr]);

  useEffect(() => {
    if (!canBrowseCloud || !source.spaceId || !source.projectId) {
      setTables([]);
      setLoadingTables(false);
      setTablesError(null);
      tablesRequestSeq.current += 1;
      return;
    }
    const requestId = ++tablesRequestSeq.current;
    setLoadingTables(true);
    setTablesError(null);
    void window.electronAPI.data
      .listCloudTables({
        ...connection,
        spaceId: source.spaceId,
        projectId: source.projectId,
        keyword: keyword.trim(),
        page: 1,
        pageSize: CLOUD_TARGET_TABLE_PAGE_SIZE,
        sortBy: 'updatedAt',
        sortOrder: 'desc',
      })
      .then((result) => {
        if (requestId !== tablesRequestSeq.current) return;
        setTables(result.tables);
      })
      .catch((loadError) => {
        if (requestId !== tablesRequestSeq.current) return;
        setTables([]);
        setTablesError(
          loadError instanceof Error
            ? loadError.message
            : tr('schedule.cloudTablesLoadFailed', '加载云分析表格失败')
        );
      })
      .finally(() => {
        if (requestId === tablesRequestSeq.current) {
          setLoadingTables(false);
        }
      });
  }, [canBrowseCloud, connection, keyword, source.projectId, source.spaceId, tr]);

  const spaceOptions = [
    { value: '', label: tr('schedule.cloudSpacePlaceholder', '选择空间') },
    ...spaces.map((space) => ({ value: space.spaceId, label: space.spaceName || space.spaceId })),
  ];
  const projectOptions = [
    { value: '', label: tr('schedule.cloudProjectPlaceholder', '选择项目') },
    ...projects.map((project) => ({
      value: project.projectId,
      label: project.projectName || project.projectId,
    })),
  ];
  const tableOptions = [
    { value: '', label: tr('schedule.cloudTablePlaceholder', '选择云表') },
    ...tables.map((table) => ({
      value: table.tableId,
      label: `${table.tableName} (${table.tableId})`,
    })),
  ];
  if (source.tableId && !tableOptions.some((option) => option.value === source.tableId)) {
    tableOptions.push({
      value: source.tableId,
      label: `${source.tableName || source.tableId} (${source.tableId})`,
    });
  }

  const selectedTable =
    tables.find((table) => table.tableId === source.tableId) ??
    (source.tableId
      ? ({
          tableId: source.tableId,
          tableName: source.tableName || source.tableId,
          spaceId: source.spaceId,
          projectId: source.projectId || '',
          datasourceId: source.datasourceId,
          folderId: source.folderId,
          columns: source.columns
            ?.map((column) => (typeof column === 'string' ? column : column.name))
            .filter((column): column is string => Boolean(column)),
          rowCount: typeof source.rowCount === 'number' ? source.rowCount : undefined,
        } satisfies PersonalAnalysisTable)
      : null);

  return (
    <div className="space-y-3.5">
      <ConfigRow label={tr('schedule.cloudSpace', '空间')}>
        <div className="relative">
          <GlassSelect
            value={source.spaceId || ''}
            options={spaceOptions}
            onValueChange={(spaceId) => {
              const nextSpace = spaces.find((space) => space.spaceId === spaceId);
              onSourceChange({
                tableId: '',
                tableName: '',
                spaceId: spaceId || undefined,
                spaceName: nextSpace?.spaceName,
                columns: [],
                rowCount: null,
              });
            }}
            disabled={!canBrowseCloud}
            triggerClassName="h-9 w-full justify-between"
            contentClassName="w-[var(--radix-select-trigger-width)]"
          />
          {loadingSpaces && (
            <Loader2 className="absolute top-1/2 right-8 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-text-muted" />
          )}
        </div>
      </ConfigRow>
      <ConfigRow label={tr('schedule.cloudProject', '项目')}>
        <div className="relative">
          <GlassSelect
            value={source.projectId || ''}
            options={projectOptions}
            onValueChange={(projectId) => {
              const nextProject = projects.find((project) => project.projectId === projectId);
              onSourceChange({
                tableId: '',
                tableName: '',
                spaceId: source.spaceId,
                spaceName: source.spaceName,
                projectId: projectId || undefined,
                projectName: nextProject?.projectName,
                folderId: nextProject?.folderId,
                columns: [],
                rowCount: null,
              });
            }}
            disabled={!canBrowseCloud || !source.spaceId}
            triggerClassName="h-9 w-full justify-between"
            contentClassName="w-[var(--radix-select-trigger-width)]"
          />
          {loadingProjects && (
            <Loader2 className="absolute top-1/2 right-8 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-text-muted" />
          )}
        </div>
      </ConfigRow>
      <ConfigRow label={tr('schedule.cloudTable', '云表')}>
        <div className="space-y-2">
          <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_minmax(12rem,0.55fr)]">
            <GlassSelect
              value={source.tableId || ''}
              options={tableOptions}
              onValueChange={(tableId) => {
                const nextTable = tables.find((table) => table.tableId === tableId);
                onSourceChange({
                  tableId,
                  tableName: nextTable?.tableName || '',
                  spaceId: nextTable?.spaceId || source.spaceId,
                  spaceName: source.spaceName,
                  projectId: nextTable?.projectId || source.projectId,
                  projectName: source.projectName,
                  datasourceId: nextTable?.datasourceId,
                  folderId: nextTable?.folderId || source.folderId,
                  rowCount: nextTable?.rowCount ?? null,
                  columns: nextTable?.columns ?? [],
                });
              }}
              disabled={!canBrowseCloud || !source.spaceId || !source.projectId}
              triggerClassName="h-9 w-full justify-between"
              contentClassName="w-[var(--radix-select-trigger-width)]"
            />
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2 text-text-muted" />
              <input
                value={keyword}
                onChange={(event) => setKeyword(event.target.value)}
                disabled={!canBrowseCloud || !source.spaceId || !source.projectId}
                placeholder={tr('schedule.cloudSourceSearchPlaceholder', '搜索云表')}
                className="input h-9 w-full pr-9 pl-8 text-xs disabled:cursor-not-allowed disabled:opacity-60"
              />
              {loadingTables && (
                <Loader2 className="absolute top-1/2 right-3 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-text-muted" />
              )}
            </div>
          </div>
          {selectedTable && (
            <div className="rounded-lg border border-border-muted bg-bg-secondary/30 px-3 py-3 text-[12px] leading-5 text-text-secondary">
              <div className="grid gap-2 sm:grid-cols-2">
                <CloudTargetInfoItem
                  label={tr('schedule.cloudTableName', '表名')}
                  value={selectedTable.tableName}
                />
                <CloudTargetInfoItem
                  label={tr('schedule.cloudTableId', '表 ID')}
                  value={selectedTable.tableId}
                  mono
                />
                <CloudTargetInfoItem
                  label={tr('schedule.cloudTableLocation', '位置')}
                  value={formatCloudTargetLocation(selectedTable, source)}
                />
                <CloudTargetInfoItem
                  label={tr('schedule.cloudTableRows', '行数')}
                  value={formatCloudTargetRows(selectedTable)}
                />
              </div>
            </div>
          )}
        </div>
      </ConfigRow>

      {!canBrowseCloud && (
        <div className="rounded-lg border border-border-muted bg-bg-secondary/30 px-3 py-2 text-[12px] leading-5 text-text-muted">
          {tr('schedule.cloudConnectRequired', '请先连接云分析空间后再选择云端表。')}
        </div>
      )}
      {error && (
        <div className="rounded-lg border border-warning/25 bg-warning/10 px-3 py-2 text-[12px] leading-5 text-warning">
          {error}
        </div>
      )}
    </div>
  );
}

export function CloudReplaceTargetSelector({
  config,
  connection,
  onTargetChange,
  tr,
}: {
  config: CloudTableAutomationConfig;
  connection: CloudConnectionPayload;
  onTargetChange: (tableId: string) => void;
  tr: (key: string, fallback: string) => string;
}) {
  const [keyword, setKeyword] = useState('');
  const [tables, setTables] = useState<PersonalAnalysisTable[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestSeq = useRef(0);
  const source = config.source;
  const sourceTable = useMemo<PersonalAnalysisTable>(
    () => ({
      tableId: source.tableId,
      tableName: source.tableName,
      spaceId: source.spaceId,
      projectId: source.projectId || '',
      datasourceId: source.datasourceId,
      folderId: source.folderId,
      columns: source.columns
        ?.map((column) => (typeof column === 'string' ? column : column.name))
        .filter((column): column is string => Boolean(column)),
      rowCount: typeof source.rowCount === 'number' ? source.rowCount : undefined,
    }),
    [source]
  );
  const canBrowseProjectTables = Boolean(
    connection.apiOrigin &&
    source.spaceId &&
    source.projectId &&
    isElectron &&
    window.electronAPI?.data
  );
  const selectedTargetId = config.output.targetTableId || source.tableId;

  useEffect(() => {
    if (!canBrowseProjectTables || !source.spaceId || !source.projectId) {
      setTables([]);
      setLoading(false);
      setError(null);
      requestSeq.current += 1;
      return;
    }

    const requestId = ++requestSeq.current;
    setLoading(true);
    setError(null);
    void window.electronAPI.data
      .listCloudTables({
        ...connection,
        spaceId: source.spaceId,
        projectId: source.projectId,
        keyword: keyword.trim(),
        page: 1,
        pageSize: CLOUD_TARGET_TABLE_PAGE_SIZE,
        sortBy: 'updatedAt',
        sortOrder: 'desc',
      })
      .then((result) => {
        if (requestId !== requestSeq.current) return;
        setTables(result.tables);
      })
      .catch((loadError) => {
        if (requestId !== requestSeq.current) return;
        setTables([]);
        setError(
          loadError instanceof Error
            ? loadError.message
            : tr('schedule.cloudTargetLoadFailed', '加载同项目云表失败')
        );
      })
      .finally(() => {
        if (requestId === requestSeq.current) {
          setLoading(false);
        }
      });
  }, [canBrowseProjectTables, connection, keyword, source.projectId, source.spaceId, tr]);

  const targetTables = useMemo(() => {
    const byId = new Map<string, PersonalAnalysisTable>();
    byId.set(sourceTable.tableId, sourceTable);
    for (const table of tables) {
      byId.set(table.tableId, table);
    }
    return Array.from(byId.values());
  }, [sourceTable, tables]);
  const selectedTable =
    targetTables.find((table) => table.tableId === selectedTargetId) ??
    (selectedTargetId === source.tableId ? sourceTable : null);
  const isReplacingSource = selectedTargetId === source.tableId;
  const options = [
    {
      value: source.tableId,
      label: tr('schedule.cloudReplaceSourceOption', '覆盖源表：{{name}}').replace(
        '{{name}}',
        source.tableName
      ),
    },
    ...targetTables
      .filter((table) => table.tableId !== source.tableId)
      .map((table) => ({
        value: table.tableId,
        label: `${table.tableName} (${table.tableId})`,
      })),
  ];
  if (selectedTargetId && !options.some((option) => option.value === selectedTargetId)) {
    options.push({
      value: selectedTargetId,
      label: tr('schedule.cloudSelectedTargetFallback', '已选目标表：{{id}}').replace(
        '{{id}}',
        selectedTargetId
      ),
    });
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_minmax(12rem,0.55fr)]">
        <GlassSelect
          value={selectedTargetId}
          options={options}
          onValueChange={onTargetChange}
          triggerClassName="h-9 w-full justify-between"
          contentClassName="w-[var(--radix-select-trigger-width)]"
        />
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2 text-text-muted" />
          <input
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            disabled={!canBrowseProjectTables}
            placeholder={tr('schedule.cloudTargetSearchPlaceholder', '搜索同项目云表')}
            className="input h-9 w-full pr-9 pl-8 text-xs disabled:cursor-not-allowed disabled:opacity-60"
          />
          {loading && (
            <Loader2 className="absolute top-1/2 right-3 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-text-muted" />
          )}
        </div>
      </div>

      {!canBrowseProjectTables && (
        <div className="rounded-lg border border-border-muted bg-bg-secondary/30 px-3 py-2 text-[12px] leading-5 text-text-muted">
          {tr(
            'schedule.cloudTargetBrowseUnavailable',
            '当前连接或源表项目信息不足，暂时只能默认覆盖源表。'
          )}
        </div>
      )}
      {error && (
        <div className="rounded-lg border border-warning/25 bg-warning/10 px-3 py-2 text-[12px] leading-5 text-warning">
          {error}
        </div>
      )}

      {selectedTable && (
        <div className="rounded-lg border border-border-muted bg-bg-secondary/30 px-3 py-3 text-[12px] leading-5 text-text-secondary">
          <div
            className={`mb-2 flex items-center gap-2 font-semibold ${
              isReplacingSource ? 'text-error' : 'text-warning'
            }`}
          >
            <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" />
            {isReplacingSource
              ? tr('schedule.cloudReplaceSourceWarningTitle', '将覆盖原始输入云表')
              : tr('schedule.cloudReplaceTargetWarningTitle', '将覆盖所选云表')}
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <CloudTargetInfoItem
              label={tr('schedule.cloudTableName', '表名')}
              value={selectedTable.tableName}
            />
            <CloudTargetInfoItem
              label={tr('schedule.cloudTableLocation', '位置')}
              value={formatCloudTargetLocation(selectedTable, source)}
            />
            <CloudTargetInfoItem
              label={tr('schedule.cloudTableId', '表 ID')}
              value={selectedTable.tableId}
              mono
            />
            <CloudTargetInfoItem
              label={tr('schedule.cloudTableRows', '行数')}
              value={formatCloudTargetRows(selectedTable)}
            />
          </div>
          <div className="mt-2 text-[12px] text-text-muted">
            {isReplacingSource
              ? tr(
                  'schedule.cloudReplaceSourceWarningDesc',
                  '运行后会用处理结果覆盖这张源表的数据，请确认这是预期操作。'
                )
              : tr(
                  'schedule.cloudReplaceTargetWarningDesc',
                  '运行后会用处理结果覆盖目标表数据，请确认目标表选择正确。'
                )}
          </div>
        </div>
      )}
    </div>
  );
}

export function CloudTargetInfoItem({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="min-w-0">
      <div className="text-text-muted">{label}</div>
      <div className={`mt-0.5 truncate text-text-primary ${mono ? 'font-mono text-[11px]' : ''}`}>
        {value || '-'}
      </div>
    </div>
  );
}

export function getCloudConnectionPayload(
  appConfig: AppConfig | null,
  desktopAuthStatus: DesktopAuthStatus
): CloudConnectionPayload {
  const storedConnection = appConfig?.personalAnalysis;
  if (desktopAuthStatus.authenticated && desktopAuthStatus.apiOrigin) {
    return { apiOrigin: desktopAuthStatus.apiOrigin };
  }
  if (storedConnection?.apiOrigin && storedConnection.apiKey) {
    return { apiOrigin: storedConnection.apiOrigin, apiKey: storedConnection.apiKey };
  }
  return { apiOrigin: storedConnection?.apiOrigin || '' };
}

export function formatCloudTargetLocation(
  table: PersonalAnalysisTable,
  source: CloudAutomationSourceTable
): string {
  const space =
    table.spaceId === source.spaceId ? source.spaceName || table.spaceId : table.spaceId;
  const project =
    table.projectId === source.projectId ? source.projectName || table.projectId : table.projectId;
  return [space, project].filter(Boolean).join(' / ') || '-';
}

export function formatCloudTargetRows(table: PersonalAnalysisTable): string {
  return typeof table.rowCount === 'number' ? String(table.rowCount) : '-';
}

export function normalizeAutomationColumns(
  columns: CloudAutomationSourceTable['columns']
): Array<{ name: string; type?: string }> {
  return (columns ?? [])
    .map((column) =>
      typeof column === 'string' ? { name: column } : { name: column.name ?? '', type: column.type }
    )
    .filter((column): column is { name: string; type?: string } => Boolean(column.name.trim()));
}
