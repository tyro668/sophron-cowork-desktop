/** Shared grid column templates (from the operator design spec, ops_grid.py). */
export const JOIN_GRID_COLUMNS = '104px minmax(200px,1fr) 120px minmax(200px,1fr) 112px';
export const AGGREGATE_GRID_COLUMNS = '104px 170px minmax(220px,1.4fr) minmax(160px,1fr) 112px';
export const PIVOT_GRID_COLUMNS = AGGREGATE_GRID_COLUMNS;
export const FIELD_MAPPING_GRID_COLUMNS =
  'minmax(180px,1fr) 58px 58px 58px minmax(160px,1fr) minmax(160px,1fr) 112px';
export const FIELD_SELECT_GRID_COLUMNS = '40px 88px 88px minmax(200px,1fr) 84px';
export const OUTPUT_GRID_COLUMNS = '104px 120px 120px 120px 120px minmax(200px,1fr)';
export const INPUT_GRID_COLUMNS = '104px 420px minmax(200px,1fr)';
export const DEDUPE_GRID_COLUMNS = '104px 120px 120px minmax(200px,1fr) 80px 80px';
export const EXPECT_GRID_COLUMNS = '104px 120px 120px 120px minmax(200px,1fr) 56px';
export const MISSING_VALUE_GRID_COLUMNS =
  '104px 120px 120px minmax(180px,1fr) minmax(200px,1.2fr) 112px';
export const TYPE_CONVERT_GRID_COLUMNS =
  'minmax(180px,1fr) 150px minmax(180px,1fr) 84px 84px 84px 112px';
export const SORT_GRID_COLUMNS = 'minmax(220px,1fr) 88px 88px 96px 96px 96px 112px';
// Design is drawn at 1000px (fixed tracks sum to 1000); the inspector panel is
// usually narrower, so fixed tracks may shrink toward their minimums instead of
// overflowing (and clipping the row actions).
export const LIMIT_GRID_COLUMNS =
  '104px minmax(96px,120px) minmax(96px,120px) minmax(80px,1fr) minmax(64px,88px) minmax(64px,88px) minmax(76px,96px) minmax(76px,96px) minmax(76px,96px) 112px';
export const CALCULATE_FIELD_GRID_COLUMNS = '88px 88px minmax(180px,1fr) minmax(280px,2fr) 112px';
export const UNPIVOT_GRID_COLUMNS = '104px 120px 120px minmax(200px,1fr)';
