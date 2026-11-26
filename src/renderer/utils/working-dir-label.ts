const DEFAULT_WORKING_DIR_NAMES = new Set(['DefaultWorkingDir', 'default_working_dir']);

export function isInternalDefaultWorkingDirPath(workingDir: string | null | undefined): boolean {
  const trimmed = workingDir?.trim();
  if (!trimmed) {
    return false;
  }
  const folderName = trimmed.split(/[/\\]/).filter(Boolean).pop();
  return Boolean(folderName && DEFAULT_WORKING_DIR_NAMES.has(folderName));
}

export function getWorkingDirDisplayName(
  workingDir: string | null | undefined,
  defaultWorkingDirLabel: string,
  emptyLabel: string
): string {
  if (!workingDir) {
    return emptyLabel;
  }

  const folderName = workingDir.split(/[/\\]/).filter(Boolean).pop();
  if (folderName && DEFAULT_WORKING_DIR_NAMES.has(folderName)) {
    return defaultWorkingDirLabel;
  }

  return folderName || workingDir;
}
