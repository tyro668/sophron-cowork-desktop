import { sanitizeUrlForLog } from '../../utils/sanitize-url';

export function sanitizeDiagnosticBaseUrl(value: string | undefined): string | null {
  if (!value) {
    return null;
  }
  return sanitizeUrlForLog(value);
}
