export function isHtmlReportPath(filePath?: string | null): boolean {
  if (!filePath) {
    return false;
  }

  const [pathWithoutQuery] = filePath.split(/[?#]/);
  return /\.html?$/i.test(pathWithoutQuery.trim());
}
