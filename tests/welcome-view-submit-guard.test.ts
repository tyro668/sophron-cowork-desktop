import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const welcomeViewPath = path.resolve(process.cwd(), 'src/renderer/components/WelcomeView.tsx');

describe('WelcomeView submit guards', () => {
  it('requires a selected model, a working folder, and at least one supported input before submitting', () => {
    const source = fs.readFileSync(welcomeViewPath, 'utf8');

    expect(source).toContain('const hasWorkingDir = Boolean(effectiveWorkingDir);');
    expect(source).toContain(
      'const canSubmit = hasSelectedModel && hasWorkingDir && hasSubmitContent;'
    );
    expect(source).toContain('disabled={!canSubmit || isSubmitting}');
  });

  it('only clears the composer after startSession returns a created session', () => {
    const source = fs.readFileSync(welcomeViewPath, 'utf8');

    expect(source).toContain(
      'const session = await startSession(sessionTitle, contentBlocks, effectiveWorkingDir, {'
    );
    expect(source).toContain('selectedSkillNames: skillMentions.selectedSkillNames');
    expect(source).toContain('if (session) {');
    expect(source).toContain("setPrompt('');");
    expect(source).toContain('setPastedImages([]);');
    expect(source).toContain('setAttachedFiles([]);');
    expect(source).toContain('clearCloudTablesFromWelcomeChat();');
    expect(source).toContain('skillMentions.clearSelectedSkills();');
  });

  it('surfaces project switch failures to the global notice toast', () => {
    const source = fs.readFileSync(welcomeViewPath, 'utf8');

    expect(source).toContain(
      'const setGlobalNotice = useAppStore((state) => state.setGlobalNotice);'
    );
    expect(source).toContain('const result = await setWorkingDirPath(path);');
    expect(source).toContain(
      "message: `${t('welcome.selectWorkingFolderFailed')}: ${result.error}`"
    );
    expect(source).toContain(": t('welcome.selectWorkingFolderFailed')");
  });

  it('filters internal default working directory and provides a CreateProjectDialog', () => {
    const source = fs.readFileSync(welcomeViewPath, 'utf8');

    expect(source).toContain('isInternalDefaultWorkingDirPath(');
    expect(source).toContain('<CreateProjectDialog');
    expect(source).toContain('title={effectiveWorkingDir || workingDirLabel}');
    expect(source).not.toContain('workingDir.split(/[/\\\\]/).pop()');
  });
});
