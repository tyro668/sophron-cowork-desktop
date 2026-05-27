export const APP_INTERNAL_NAME = 'sophron';
export const APP_NAME_EN = 'sophron cowork';
export const APP_NAME_ZH = '九思助理';

export function getAppNameForLanguage(language: string | undefined): string {
  return language?.toLowerCase().startsWith('zh') ? APP_NAME_ZH : APP_NAME_EN;
}
