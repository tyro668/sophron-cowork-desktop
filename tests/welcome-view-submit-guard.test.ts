import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const welcomeViewPath = path.resolve(process.cwd(), 'src/renderer/components/WelcomeView.tsx');

describe('WelcomeView submit guards', () => {
  it('requires a selected model and at least one supported input before submitting', () => {
    const source = fs.readFileSync(welcomeViewPath, 'utf8');

    expect(source).toMatch(
      /const canSubmit =\s*hasSelectedModel &&\s*\(prompt\.trim\(\)\.length > 0 \|\|\s*pastedImages\.length > 0 \|\|\s*attachedFiles\.length > 0 \|\|\s*attachedCloudTables\.length > 0\);/
    );
    expect(source).toContain('disabled={!canSubmit || isSubmitting}');
  });

  it('only clears the composer after startSession returns a created session', () => {
    const source = fs.readFileSync(welcomeViewPath, 'utf8');

    expect(source).toContain(
      'const session = await startSession(sessionTitle, contentBlocks, workingDir || undefined, {'
    );
    expect(source).toContain('selectedSkillNames: skillMentions.selectedSkillNames');
    expect(source).toContain('if (session) {');
    expect(source).toContain("setPrompt('');");
    expect(source).toContain('setPastedImages([]);');
    expect(source).toContain('setAttachedFiles([]);');
    expect(source).toContain('clearCloudTablesFromWelcomeChat();');
    expect(source).toContain('skillMentions.clearSelectedSkills();');
  });

  it('surfaces working-directory picker failures to the global notice toast', () => {
    const source = fs.readFileSync(welcomeViewPath, 'utf8');

    expect(source).toContain(
      'const setGlobalNotice = useAppStore((state) => state.setGlobalNotice);'
    );
    expect(source).toContain(
      'const result = await changeWorkingDir(undefined, workingDir || undefined);'
    );
    expect(source).toContain(
      "message: `${t('welcome.selectWorkingFolderFailed')}: ${result.error}`"
    );
    expect(source).toContain(": t('welcome.selectWorkingFolderFailed')");
  });

  it('uses an i18n display label for the internal default working directory', () => {
    const source = fs.readFileSync(welcomeViewPath, 'utf8');

    expect(source).toContain('getWorkingDirDisplayName(');
    expect(source).toContain("t('welcome.defaultWorkingFolder')");
    expect(source).toContain('title={workingDir || workingDirLabel}');
    expect(source).not.toContain('workingDir.split(/[/\\\\]/).pop()');
  });
});
