import type { TFunction } from 'i18next';
import {
  detectCommonProviderSetup,
  getFallbackOpenAISetup,
  isParsableBaseUrl,
  orderCommonProviderSetups,
  resolveProviderGuidanceErrorHint,
  type CommonProviderSetup,
} from '../../shared/api-provider-guidance';
import type { CustomProtocolType, ProviderPresets, ProviderType } from '../types';
import { protocolLabel, providerTabLabel } from './api-config-model';

export interface ApiProviderGuidanceInput {
  provider: ProviderType;
  customProtocol: CustomProtocolType;
  baseUrl: string;
  presets: ProviderPresets;
  testResultDetails?: string;
  t: TFunction;
}

export function computeApiProviderGuidance({
  provider,
  customProtocol,
  baseUrl,
  presets,
  testResultDetails,
  t,
}: ApiProviderGuidanceInput) {
  const detectedProviderSetup = provider === 'custom' ? detectCommonProviderSetup(baseUrl) : null;
  const fallbackOpenAISetup = getFallbackOpenAISetup();

  const effectiveProviderSetup =
    detectedProviderSetup ??
    (provider === 'custom' &&
    customProtocol === 'openai' &&
    baseUrl.trim() &&
    isParsableBaseUrl(baseUrl)
      ? fallbackOpenAISetup
      : null);

  const setupDisplayProtocol = (setup: CommonProviderSetup) =>
    setup.protocolLabel || protocolLabel(setup.recommendedProtocol, t);

  const protocolGuidanceTone: 'info' | 'warning' | undefined =
    provider !== 'custom' || !detectedProviderSetup
      ? undefined
      : detectedProviderSetup.preferProviderTab
        ? 'warning'
        : customProtocol === detectedProviderSetup.recommendedProtocol
          ? 'info'
          : 'warning';

  let protocolGuidanceText = '';
  if (provider === 'custom' && detectedProviderSetup) {
    const serviceName = t(detectedProviderSetup.nameKey);
    if (detectedProviderSetup.preferProviderTab) {
      protocolGuidanceText = t('api.guidance.preferProviderTab', {
        service: serviceName,
        provider: providerTabLabel(detectedProviderSetup.preferProviderTab, presets, t),
      });
    } else if (customProtocol !== detectedProviderSetup.recommendedProtocol) {
      protocolGuidanceText = t('api.guidance.protocolMismatch', {
        service: serviceName,
        recommendedProtocol: setupDisplayProtocol(detectedProviderSetup),
      });
    } else {
      protocolGuidanceText = t('api.guidance.protocolLooksGood', {
        service: serviceName,
        recommendedProtocol: setupDisplayProtocol(detectedProviderSetup),
      });
    }
  }

  let baseUrlGuidanceText = '';
  if (provider === 'custom' && effectiveProviderSetup) {
    if (!detectedProviderSetup && effectiveProviderSetup.id === fallbackOpenAISetup.id) {
      baseUrlGuidanceText = t('api.guidance.genericBaseUrlHint', {
        recommendedProtocol: setupDisplayProtocol(effectiveProviderSetup),
        baseUrl: effectiveProviderSetup.recommendedBaseUrl,
        model: effectiveProviderSetup.exampleModel,
      });
    } else {
      baseUrlGuidanceText = t('api.guidance.baseUrlHint', {
        service: t(effectiveProviderSetup.nameKey),
        recommendedProtocol: setupDisplayProtocol(effectiveProviderSetup),
        baseUrl: effectiveProviderSetup.recommendedBaseUrl,
        model: effectiveProviderSetup.exampleModel,
      });
    }
  }

  const commonProviderSetups =
    provider === 'custom'
      ? orderCommonProviderSetups(detectedProviderSetup?.id).map((setup) => ({
          id: setup.id,
          name: t(setup.nameKey),
          protocolLabel: setupDisplayProtocol(setup),
          baseUrl: setup.recommendedBaseUrl,
          exampleModel: setup.exampleModel,
          notes: t(setup.noteKey),
          isDetected: setup.id === detectedProviderSetup?.id,
        }))
      : [];

  let friendlyTestDetails = '';
  const hintKind = resolveProviderGuidanceErrorHint(testResultDetails, detectedProviderSetup);
  if (hintKind === 'emptyProbePreferProvider' && detectedProviderSetup?.preferProviderTab) {
    friendlyTestDetails = t('api.guidance.errorHints.emptyProbePreferProvider', {
      service: t(detectedProviderSetup.nameKey),
      provider: providerTabLabel(detectedProviderSetup.preferProviderTab, presets, t),
    });
  } else if (hintKind === 'emptyProbeDetected' && effectiveProviderSetup) {
    friendlyTestDetails = t('api.guidance.errorHints.emptyProbeDetected', {
      service: t(effectiveProviderSetup.nameKey),
      recommendedProtocol: setupDisplayProtocol(effectiveProviderSetup),
    });
  } else if (hintKind === 'emptyProbeGeneric') {
    friendlyTestDetails = t('api.guidance.errorHints.emptyProbeGeneric');
  } else if (hintKind === 'probeMismatchDetected' && effectiveProviderSetup) {
    friendlyTestDetails = t('api.guidance.errorHints.probeMismatchDetected', {
      service: t(effectiveProviderSetup.nameKey),
      recommendedProtocol: setupDisplayProtocol(effectiveProviderSetup),
    });
  } else if (hintKind === 'probeMismatchGeneric') {
    friendlyTestDetails = t('api.guidance.errorHints.probeMismatchGeneric');
  }

  return {
    detectedProviderSetup,
    protocolGuidanceTone,
    protocolGuidanceText,
    baseUrlGuidanceText,
    commonProviderSetups,
    friendlyTestDetails,
  };
}
