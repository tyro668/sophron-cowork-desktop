const DEFAULT_WORKING_DIR_NAMES = new Set(['DefaultWorkingDir', 'default_working_dir']);

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
