import { ipcRenderer } from 'electron';
import type {
  ScheduleCreateInput,
  ScheduleTask,
  ScheduleUpdateInput,
} from '../../shared/contracts';
import type { ElectronApi } from '../../shared/contracts/electron-api';

export function createScheduleApi(): ElectronApi['schedule'] {
  return {
    list: (): Promise<ScheduleTask[]> => ipcRenderer.invoke('schedule.list'),
    create: (payload: ScheduleCreateInput): Promise<ScheduleTask> =>
      ipcRenderer.invoke('schedule.create', payload),
    update: (id: string, updates: ScheduleUpdateInput): Promise<ScheduleTask | null> =>
      ipcRenderer.invoke('schedule.update', id, updates),
    delete: (id: string): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('schedule.delete', id),
    toggle: (id: string, enabled: boolean): Promise<ScheduleTask | null> =>
      ipcRenderer.invoke('schedule.toggle', id, enabled),
    runNow: (id: string): Promise<ScheduleTask | null> => ipcRenderer.invoke('schedule.runNow', id),
  };
}
