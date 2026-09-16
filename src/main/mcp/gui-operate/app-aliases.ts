/**
 * App-name aliasing and description scoring: multilingual alias groups plus
 * pure text-matching helpers shared by the click-history tracker and the
 * macOS Dock accessibility locator.
 */

export const APP_NAME_ALIAS_GROUPS: string[][] = [
  ['calendar', '日历'],
  ['notes', '备忘录'],
  ['music', '音乐'],
  ['finder', '访达'],
  ['system settings', 'settings', '系统设置'],
  ['ticktick', '滴答清单'],
  ['wechat', '微信'],
  ['trash', '废纸篓'],
  ['chrome', 'google chrome'],
];

export function normalizeText(text: string): string {
  return text.toLowerCase().trim();
}

export function compactText(text: string): string {
  return normalizeText(text).replace(/[\s_-]+/g, '');
}

export function inferExpectedAppAliasesFromText(text: string): string[] {
  const normalized = normalizeText(text);
  const compact = compactText(text);
  const aliases = new Set<string>();

  for (const group of APP_NAME_ALIAS_GROUPS) {
    const normalizedGroup = group.map((token) => normalizeText(token));
    const compactGroup = group.map((token) => compactText(token));
    const matched =
      normalizedGroup.some((token) => token && normalized.includes(token)) ||
      compactGroup.some((token) => token && compact.includes(token));

    if (matched) {
      for (const token of normalizedGroup) {
        if (token) aliases.add(token);
      }
      for (const token of compactGroup) {
        if (token) aliases.add(token);
      }
    }
  }

  return Array.from(aliases);
}

export function getAliasTokensForAppName(appName: string): string[] {
  const normalizedName = normalizeText(appName);
  const compactName = compactText(appName);
  const tokens = new Set<string>([normalizedName, compactName]);

  for (const group of APP_NAME_ALIAS_GROUPS) {
    const normalizedGroup = group.map((token) => normalizeText(token));
    const compactGroup = group.map((token) => compactText(token));
    const matched = normalizedGroup.includes(normalizedName) || compactGroup.includes(compactName);
    if (!matched) continue;

    for (const token of normalizedGroup) {
      if (token) tokens.add(token);
    }
    for (const token of compactGroup) {
      if (token) tokens.add(token);
    }
  }

  return Array.from(tokens).filter(
    (token) => token && token !== 'null' && token !== 'missingvalue'
  );
}

export function scoreDockItemAgainstDescription(itemName: string, description: string): number {
  const normalizedDescription = normalizeText(description);
  const compactDescription = compactText(description);
  const tokens = getAliasTokensForAppName(itemName);
  let bestScore = 0;

  for (const token of tokens) {
    if (token.length < 2) continue;

    if (normalizedDescription.includes(token)) {
      bestScore = Math.max(bestScore, 120 + token.length);
    }

    const compactToken = compactText(token);
    if (compactToken.length >= 2 && compactDescription.includes(compactToken)) {
      bestScore = Math.max(bestScore, 110 + compactToken.length);
    }
  }

  return bestScore;
}

export function isDescriptionDockRelated(description: string): boolean {
  const normalized = normalizeText(description);
  return /dock|下边栏|程序坞|底栏/.test(normalized);
}

export function isLikelyAppLaunchVerification(question: string): boolean {
  const normalized = normalizeText(question);
  const mentionsApp = /(app|application|应用|程序|软件)/i.test(normalized);
  const mentionsMenuLike = /(menu|菜单|弹窗|popup|面板|widget|小组件|下拉)/i.test(normalized);
  return mentionsApp && !mentionsMenuLike;
}

export function appNameMatchesAliases(appName: string, aliases: string[]): boolean {
  const normalizedName = normalizeText(appName);
  const compactName = compactText(appName);

  return aliases.some((alias) => {
    const normalizedAlias = normalizeText(alias);
    const compactAlias = compactText(alias);

    return (
      (normalizedAlias &&
        (normalizedName.includes(normalizedAlias) || normalizedAlias.includes(normalizedName))) ||
      (compactAlias && (compactName.includes(compactAlias) || compactAlias.includes(compactName)))
    );
  });
}
