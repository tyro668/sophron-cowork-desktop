import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  beginSkillUsageRun,
  countSkillInvocationsSince,
  recordSkillInvocation,
  setSkillUsageSink,
  skillNameFromToolInput,
} from '../src/main/skills/skill-usage';
import { skillUsageCount } from '../src/renderer/components/settings/SettingsSkills';

describe('skill usage log', () => {
  const record = vi.fn();
  beforeEach(() => {
    record.mockReset();
    setSkillUsageSink({ record, countSince: () => ({ xlsx: 3 }) });
  });

  it('counts a skill once per run even if selected and then loaded', () => {
    beginSkillUsageRun('s1');
    expect(recordSkillInvocation('xlsx', 's1', 'selected', 5)).toBe(true);
    expect(recordSkillInvocation('XLSX', 's1', 'loaded', 6)).toBe(false);
    beginSkillUsageRun('s1');
    expect(recordSkillInvocation('xlsx', 's1', 'loaded', 7)).toBe(true);
    expect(record).toHaveBeenCalledTimes(2);
    expect(record).toHaveBeenCalledWith({
      skillName: 'xlsx',
      sessionId: 's1',
      source: 'selected',
      invokedAt: 5,
    });
  });

  it('is a no-op without a sink', () => {
    setSkillUsageSink(null);
    expect(recordSkillInvocation('xlsx', null, 'loaded')).toBe(false);
    expect(countSkillInvocationsSince(0)).toEqual({});
  });

  it('detects SKILL.md reads', () => {
    expect(skillNameFromToolInput('read', { path: '/x/skills/pptx/SKILL.md' })).toBe('pptx');
    expect(skillNameFromToolInput('read', { file_path: 'C:\\s\\docx\\SKILL.md' })).toBe('docx');
    expect(skillNameFromToolInput('read', { path: '/x/README.md' })).toBeNull();
    expect(skillNameFromToolInput('bash', { path: '/x/pptx/SKILL.md' })).toBeNull();
  });

  it('matches counts by skill name or directory', () => {
    expect(skillUsageCount({ XLSX: 2, other: 1 }, { name: 'Excel', path: '/s/xlsx' })).toBe(2);
    expect(skillUsageCount({}, { name: 'a' })).toBe(0);
  });
});
