import { Table2 } from 'lucide-react';
import type { DataRawSourceScan } from '../../../types';
import { cellInputClass, groupClass, InfoTip, SELECT_CHEVRON, Toggle, type Tr } from './shared';

export function SheetConfigurator(props: {
  tr: Tr;
  scan: DataRawSourceScan;
  multi: boolean;
  singleSheet: string | null;
  setSingleSheet: (name: string) => void;
  checked: string[];
  setChecked: (names: string[]) => void;
  names: Record<string, string>;
  setNames: (names: Record<string, string>) => void;
  headerRows: Record<string, number | undefined>;
  setHeaderRows: (rows: Record<string, number | undefined>) => void;
  fileStem: string;
  mergeSheets: boolean;
  setMergeSheets: (on: boolean) => void;
  mergeable: boolean;
  mergedName: string;
  setMergedName: (name: string) => void;
  autoInclude: boolean;
  setAutoInclude: (on: boolean) => void;
}) {
  const { tr, scan, multi, checked } = props;
  const toggle = (name: string) =>
    props.setChecked(
      checked.includes(name) ? checked.filter((item) => item !== name) : [...checked, name]
    );
  const merged = multi && props.mergeSheets && props.mergeable;
  const selectable = scan.sheets.filter((s) => !s.empty).map((s) => s.name);
  const allChecked = selectable.length > 0 && selectable.every((name) => checked.includes(name));
  const mergeReason =
    checked.length < 2
      ? tr('excel.mergeNeedTwo')
      : !props.mergeable
        ? tr('excel.mergeDisabled')
        : '';
  const showName = !merged;
  return (
    <>
      {multi && (
        <section className={groupClass} data-testid="raw-source-import-group">
          <div className="ui-group-title">{tr('config.importGroup')}</div>
          <div className="ui-form-row">
            <div className="ui-form-label items-center">{tr('config.mergeRow')}</div>
            <div className="ui-form-value">
              <div className="flex flex-1 items-center gap-2 px-2.5">
                <Toggle
                  on={merged}
                  disabled={!props.mergeable}
                  onChange={props.setMergeSheets}
                  label={merged ? tr('config.on') : tr('config.off')}
                  testId="raw-source-merge-sheets"
                />
                {mergeReason ? <InfoTip label={mergeReason} /> : null}
                {merged && (
                  <span className="text-[12px] text-text-muted">{tr('excel.mergeOn')}</span>
                )}
              </div>
            </div>
          </div>
          {merged ? (
            <div className="ui-form-row">
              <div className="ui-form-label items-center">{tr('excel.tableName')}</div>
              <div className="ui-form-value">
                <input
                  value={props.mergedName}
                  onChange={(event) => props.setMergedName(event.target.value)}
                  className={cellInputClass}
                  data-testid="raw-source-merged-name"
                />
              </div>
            </div>
          ) : (
            <div className="ui-form-row">
              <div className="ui-form-label items-center">{tr('config.newSheetRow')}</div>
              <div className="ui-form-value">
                <div className="flex flex-1 items-center px-2.5">
                  <Toggle
                    on={props.autoInclude}
                    onChange={props.setAutoInclude}
                    label={tr('excel.autoIncludeSheets')}
                    testId="raw-source-auto-include"
                  />
                </div>
              </div>
            </div>
          )}
        </section>
      )}
      <section className={groupClass} data-testid="raw-source-sheet-list">
        <div className="ui-group-title gap-2">
          <span>{tr('config.sheetGroup')}</span>
          {multi ? (
            <>
              <span className="font-normal text-text-muted" data-testid="raw-source-selected-count">
                {tr('excel.selected', { selected: checked.length, total: scan.sheets.length })}
              </span>
              <button
                type="button"
                className="ml-auto font-normal text-accent"
                onClick={() => props.setChecked(selectable)}
              >
                {tr('config.selectAll')}
              </button>
            </>
          ) : (
            <span className="font-normal text-text-muted">{tr('excel.pickOne')}</span>
          )}
        </div>
        <table className="w-full table-fixed border-collapse text-left text-[12.5px]">
          <colgroup>
            <col className="w-9" />
            <col className="w-[28%]" />
            {showName && <col />}
            <col className="w-[26%]" />
            <col className="w-[92px]" />
          </colgroup>
          <thead>
            <tr className="h-8 border-b border-border-subtle bg-surface-muted text-[12px] text-text-secondary">
              <th className="border-r border-border-subtle text-center">
                {multi ? (
                  <input
                    type="checkbox"
                    aria-label={tr('config.selectAll')}
                    checked={allChecked}
                    onChange={() => props.setChecked(allChecked ? [] : selectable)}
                    data-testid="raw-source-sheet-all"
                    className="accent-[var(--color-accent)] align-middle"
                  />
                ) : null}
              </th>
              <th className="border-r border-border-subtle px-2.5 font-medium">
                {tr('folder.colSheet')}
              </th>
              {showName && (
                <th className="border-r border-border-subtle px-2.5 font-medium">
                  {tr('excel.tableName')}
                </th>
              )}
              <th className="border-r border-border-subtle px-2.5 font-medium">
                {tr('excel.headerRow')}
              </th>
              <th className="px-2.5 text-right font-medium">{tr('excel.size')}</th>
            </tr>
          </thead>
          <tbody>
            {scan.sheets.map((sheet) => {
              const active = multi
                ? checked.includes(sheet.name)
                : props.singleSheet === sheet.name;
              const defaultName = multi ? `${props.fileStem} / ${sheet.name}` : props.fileStem;
              return (
                <tr
                  key={sheet.name}
                  className={`h-9 border-b border-border-subtle last:border-b-0 ${active ? 'bg-accent/[0.04]' : ''} ${sheet.empty ? 'opacity-50' : ''}`}
                  data-testid={`raw-source-sheet-row-${sheet.name}`}
                >
                  <td className="border-r border-border-subtle text-center">
                    <input
                      type={multi ? 'checkbox' : 'radio'}
                      checked={active}
                      disabled={sheet.empty}
                      aria-label={sheet.name}
                      onChange={() =>
                        multi ? toggle(sheet.name) : props.setSingleSheet(sheet.name)
                      }
                      data-testid={`raw-source-sheet-${sheet.name}`}
                      className="accent-[var(--color-accent)] align-middle"
                    />
                  </td>
                  <td className="border-r border-border-subtle px-2.5">
                    <span className="flex min-w-0 items-center gap-1.5 text-text-primary">
                      <Table2 className="h-3.5 w-3.5 flex-shrink-0 text-text-muted" />
                      <span className="truncate" title={sheet.name}>
                        {sheet.name}
                      </span>
                    </span>
                  </td>
                  {showName && (
                    <td className="border-r border-border-subtle p-0">
                      {active ? (
                        <input
                          value={props.names[sheet.name] ?? defaultName}
                          onChange={(event) =>
                            props.setNames({ ...props.names, [sheet.name]: event.target.value })
                          }
                          aria-label={tr('excel.tableName')}
                          className={cellInputClass}
                          data-testid={multi ? undefined : 'raw-source-table-name'}
                        />
                      ) : (
                        <span className="px-2.5 text-text-muted">—</span>
                      )}
                    </td>
                  )}
                  <td className="border-r border-border-subtle p-0">
                    <select
                      value={props.headerRows[sheet.name] ?? ''}
                      disabled={!active}
                      aria-label={tr('excel.headerRow')}
                      onChange={(event) =>
                        props.setHeaderRows({
                          ...props.headerRows,
                          [sheet.name]: event.target.value ? Number(event.target.value) : undefined,
                        })
                      }
                      className={`${cellInputClass} cursor-pointer appearance-none bg-[length:12px] bg-[right_10px_center] bg-no-repeat pr-7`}
                      style={{ backgroundImage: SELECT_CHEVRON }}
                    >
                      <option value="">{tr('excel.headerAuto')}</option>
                      {[1, 2, 3, 4, 5].map((row) => (
                        <option key={row} value={row}>
                          {tr('excel.headerManual', { row })}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-2.5 text-right tabular-nums text-text-muted">
                    {sheet.empty
                      ? tr('excel.sheetEmpty', { rows: sheet.rowCount })
                      : tr('config.sizeCompact', { rows: sheet.rowCount, cols: sheet.columnCount })}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </>
  );
}
