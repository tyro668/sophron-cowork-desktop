import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { AgentRunnerSkills } from '../src/main/agent/agent-runner-skills';

describe('agent runtime directory preparation', () => {
  it('retries failed preparation, caches success, and rebuilds after invalidation', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'runtime-skills-'));
    try {
      const skills = new AgentRunnerSkills({ sendToRenderer: vi.fn() });
      vi.spyOn(skills, 'getAppAgentDir').mockReturnValue(root);
      vi.spyOn(skills, 'getBuiltinSkillsPath').mockReturnValue(path.join(root, 'absent'));
      vi.spyOn(skills, 'syncUserSkillsToAppDir').mockImplementation(() => {});
      const sync = vi
        .spyOn(skills, 'syncConfiguredSkillsToRuntimeDir')
        .mockImplementationOnce(() => {
          throw new Error('Storage busy');
        })
        .mockImplementation(() => {});
      expect(() => skills.prepareRuntimeDirectory()).toThrow('Storage busy');
      expect(skills.prepareRuntimeDirectory()).toBe(root);
      expect(skills.prepareRuntimeDirectory()).toBe(root);
      expect(sync).toHaveBeenCalledTimes(2);
      skills.invalidateSetup();
      skills.prepareRuntimeDirectory();
      expect(sync).toHaveBeenCalledTimes(3);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
