import { appContext } from '../../app/context';
import { AutomationService } from '../../automation/automation-service';

export function requireAutomationService(): AutomationService {
  if (!appContext.automationService) {
    throw new Error('Automation service not initialized');
  }
  return appContext.automationService;
}

export function rescheduleAutomations(): void {
  appContext.automationScheduler?.reschedule();
}
