// Operator form props live in ./types (no import cycle: form components import
// the props type from here without pulling the registry). The lazy form loaders
// themselves are registered in the renderer operator registry —
// data-view/data-pipelines/workflow/operator-catalog.ts (OPERATOR_UI).
export type { OperatorFormProps, OperatorFormComponent, OperatorFormLoader } from './types';
export {
  hasOperatorForm,
  getOperatorFormLoader,
} from '../data-view/data-pipelines/workflow/operator-catalog';
