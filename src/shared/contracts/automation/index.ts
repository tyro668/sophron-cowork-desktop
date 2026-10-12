/**
 * Cross-process automation contracts. Shared by main, preload, and renderer.
 * Must not import from main/, renderer/, or preload/.
 */
// Canonical definitions live in `../../automation/types`; re-exported here so
// `shared/contracts` is the single import surface for cross-process types.
export type {
  Automation,
  AutomationTableRef,
  AutomationTablePolicy,
  AutomationOutputBinding,
  AutomationActionDefinitionSummary,
  AutomationActionGraph,
  AutomationActionNode,
  AutomationArtifact,
  AutomationAssignGroupInput,
  AutomationConcurrencyPolicy,
  AutomationCreateGroupInput,
  AutomationCreateInput,
  AutomationDeliveryConfig,
  AutomationDeliveryChannel,
  AutomationGroup,
  AutomationListQuery,
  AutomationListResult,
  AutomationRenameGroupInput,
  AutomationRun,
  AutomationRunQuery,
  AutomationTrigger,
  AutomationUpdateInput,
} from '../../automation/types';
