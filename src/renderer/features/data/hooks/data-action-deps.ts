import type { TFunction } from 'i18next';
import type { ConfirmDialogOptions } from '../../../components/ConfirmDialog';
import type { DataViewUi } from './use-data-view-ui';
import type { DataDashboardState } from './use-data-dashboard';
import type { RawTablesState } from './use-raw-tables';
import type { RawTableDraftsState } from './use-raw-table-drafts';
import type { DataViewEditors } from './use-data-view-editors';
export interface DataActionsDeps {
  ui: DataViewUi;
  dashboard: DataDashboardState;
  rawTables: RawTablesState;
  drafts: RawTableDraftsState;
  editors: DataViewEditors;
  t: TFunction;
  confirmDelete: (options: ConfirmDialogOptions) => Promise<boolean>;
}
