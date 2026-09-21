export function buildFileAttachmentPrompt(
  files: Array<{ filename: string; size: number; relativePath: string }>
): string {
  const fileInfo = files
    .map(
      (file) =>
        `- ${file.filename} (${(file.size / 1024).toFixed(1)} KB) at path: ${file.relativePath}`
    )
    .join('\n');
  return `[Attached files - use Read tool to access them]:\n${fileInfo}`;
}

export function buildCloudTableAttachmentPrompt(payload: unknown): string {
  return [
    '[Cloud analysis tables added to this conversation]',
    'Use these Cloud Space table references when answering the user.',
    'If the user asks to modify or overwrite a cloud table, first import the table into the local cowork data workspace, create or update a local output table, then ask for confirmation before uploading with REPLACE mode.',
    JSON.stringify(payload, null, 2),
  ].join('\n');
}
