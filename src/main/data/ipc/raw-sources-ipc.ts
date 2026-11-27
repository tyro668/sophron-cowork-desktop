import type {
  DataResolveRawSourceRenamesInput,
  DataCreateRawSourceInput,
  DataRebuildRawSourceInput,
  DataChangeRawSourcePathInput,
  DataUpdateRawSourceConfigInput,
  DataScanRawSourceInput,
} from '../../../shared/contracts';
import type { IpcChannel } from '../../../shared/contracts/ipc/schemas';
import { handleIpc } from '../../ipc-handle';
import { rawTableIssue } from '../store/csv-encoding';
import { sanitizeRawTableForIpc } from '../store/input-source';
import type { RawSourceService } from '../store/services/raw-source-service';

export function registerRawSourcesIpc(
  getSources: () => RawSourceService,
  logError: (...args: unknown[]) => void
): void {
  const sourceChannel = <A extends unknown[], R>(
    channel: IpcChannel,
    label: string,
    run: (...args: A) => Promise<R>
  ) =>
    handleIpc(channel, async (_event, ...args: A) => {
      try {
        return await run(...args);
      } catch (error) {
        logError(`[Data] Error ${label}:`, error);
        const issue = rawTableIssue(error);
        if (issue) return issue;
        throw error;
      }
    });
  sourceChannel('data.listRawSources', 'listing raw sources', () => getSources().listSources());
  sourceChannel('data.scanRawSource', 'scanning raw source', (payload: DataScanRawSourceInput) =>
    getSources().scanSource(payload)
  );
  sourceChannel(
    'data.createRawSource',
    'creating raw source',
    (payload: DataCreateRawSourceInput) =>
      getSources()
        .createSource(payload)
        .then((result) => ({
          ...result,
          tables: result.tables.map((table) => sanitizeRawTableForIpc(table)),
        }))
  );
  sourceChannel(
    'data.resolveRawSourceRenames',
    'resolving raw source renames',
    (input: DataResolveRawSourceRenamesInput) => getSources().resolveRenames(input)
  );
  sourceChannel(
    'data.setRawSourceAutoInclude',
    'updating raw source',
    (id: string, autoInclude: boolean) => getSources().setAutoInclude(id, autoInclude)
  );
  sourceChannel('data.refreshRawSource', 'refreshing raw source', (id: string) =>
    getSources().refreshSource(id)
  );
  sourceChannel(
    'data.changeRawSourcePath',
    'changing raw source path',
    (payload: DataChangeRawSourcePathInput) => getSources().changeSourcePath(payload)
  );
  sourceChannel(
    'data.updateRawSourceConfig',
    'updating raw source config',
    (payload: DataUpdateRawSourceConfigInput) => getSources().updateSourceConfig(payload)
  );
  sourceChannel('data.getRawSourceRebuildImpact', 'reading rebuild impact', (id: string) =>
    getSources().getRebuildImpact(id)
  );
  sourceChannel(
    'data.rebuildRawSource',
    'rebuilding raw source',
    (payload: DataRebuildRawSourceInput) =>
      getSources()
        .rebuildSource(payload)
        .then((result) => ({
          ...result,
          tables: result.tables.map((table) => sanitizeRawTableForIpc(table)),
        }))
  );
  sourceChannel('data.deleteRawSource', 'deleting raw source', (id: string) =>
    getSources().deleteSource(id)
  );
}
