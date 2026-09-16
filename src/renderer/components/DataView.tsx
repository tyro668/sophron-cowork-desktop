// Thin re-export — the data workspace lives in features/data (pages/hooks/
// model/api slices). Kept so existing imports (`App.tsx`, tests) stay valid.
export { DataViewPage as DataView } from '../features/data/pages/DataViewPage';
