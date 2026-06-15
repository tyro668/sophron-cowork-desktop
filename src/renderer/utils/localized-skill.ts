import type { Skill } from '../types';

export function getLocalizedSkillDescription(
  skill: Pick<Skill, 'description' | 'descriptionEn' | 'descriptionZh'>,
  language?: string
): string {
  const normalizedLanguage = (language || '').toLocaleLowerCase();
  if (normalizedLanguage.startsWith('zh')) {
    return skill.descriptionZh || skill.description || skill.descriptionEn || '';
  }
  return skill.descriptionEn || skill.description || skill.descriptionZh || '';
}
