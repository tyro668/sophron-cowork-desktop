import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const panelPath = path.resolve(process.cwd(), 'src/renderer/components/RemoteControlPanel.tsx');
const detailPath = path.resolve(
  process.cwd(),
  'src/renderer/components/remote/ChannelDetailPanel.tsx'
);
const channelStatePath = path.resolve(
  process.cwd(),
  'src/renderer/components/remote/channel-state.ts'
);
const setupGuidePath = path.resolve(
  process.cwd(),
  'src/renderer/components/remote/ChannelSetupGuide.tsx'
);
const brandIconPath = path.resolve(
  process.cwd(),
  'src/renderer/components/remote/ChannelBrandIcon.tsx'
);

describe('RemoteControlPanel multi-channel UI', () => {
  it('renders channel navigation, list, and detail components', () => {
    const source = readFileSync(panelPath, 'utf8');

    expect(source).toContain('<RemoteSectionNav');
    expect(source).toContain('<ChannelList');
    expect(source).toContain('<ChannelDetailPanel');
    expect(source).toContain("type: 'dingtalk'");
    expect(source).toContain("type: 'wecom'");
  });

  it('keeps only unsupported channel saving disabled in the UI layer', () => {
    const source = readFileSync(detailPath, 'utf8');

    expect(source).toContain('!channel.backendAvailable || isSaving');
    expect(source).toContain('previewOnlyNotice');
  });

  it('provides step-by-step setup guides for all three channels', () => {
    const detailSource = readFileSync(detailPath, 'utf8');
    const guideSource = readFileSync(setupGuidePath, 'utf8');

    expect(detailSource).toContain('<ChannelSetupGuide');
    expect(guideSource).toContain('FEISHU_PERMISSION_SCOPES');
    expect(guideSource).toContain('im.message.receive_v1');
    expect(guideSource).toContain('dingtalk: [');
    expect(guideSource).toContain('wecom: [');
  });

  it('keeps setup guide copy in both locales', () => {
    for (const locale of ['zh', 'en']) {
      const localePath = path.resolve(process.cwd(), `src/shared/i18n/locales/${locale}.json`);
      const messages = JSON.parse(readFileSync(localePath, 'utf8'));

      expect(messages.remote.setupGuide.steps.feishu.finish).toBeTruthy();
      expect(messages.remote.setupGuide.steps.dingtalk.test).toBeTruthy();
      expect(messages.remote.setupGuide.steps.wecom.test).toBeTruthy();
      expect(messages.remote.setupGuide.steps.wecom.webhookConnection).toBeTruthy();
      expect(messages.remote.setupGuide.steps.wecom.webhookCredentials).toBeTruthy();
      expect(messages.remote.setupGuide.warning.wecom).toBeTruthy();
    }
  });

  it('uses platform-only channel names in both locales', () => {
    const expectedNames = {
      zh: { feishu: '飞书', dingtalk: '钉钉', wecom: '企业微信' },
      en: { feishu: 'Feishu', dingtalk: 'DingTalk', wecom: 'WeCom' },
    };

    for (const locale of ['zh', 'en'] as const) {
      const localePath = path.resolve(process.cwd(), `src/shared/i18n/locales/${locale}.json`);
      const messages = JSON.parse(readFileSync(localePath, 'utf8'));

      expect(messages.remote.channelName).toEqual(expectedNames[locale]);
    }
  });

  it('uses bundled official app icons for every visible channel', () => {
    const source = readFileSync(brandIconPath, 'utf8');

    for (const channel of ['feishu', 'dingtalk', 'wecom']) {
      expect(source).toContain(`assets/${channel}.png`);

      const imagePath = path.resolve(process.cwd(), `src/renderer/assets/${channel}.png`);
      const image = readFileSync(imagePath);
      expect(image.subarray(1, 4).toString()).toBe('PNG');
    }
  });

  it('calls DingTalk and WeCom backend APIs', () => {
    const source = readFileSync(panelPath, 'utf8');

    expect(source).toContain('updateDingtalkConfig');
    expect(source).toContain('updateWecomConfig');
    expect(source).toContain('backendAvailable: true');
  });

  it('exposes independent enable and disable controls for every configured bot', () => {
    const panelSource = readFileSync(panelPath, 'utf8');
    const detailSource = readFileSync(detailPath, 'utf8');
    const channelStateSource = readFileSync(channelStatePath, 'utf8');

    expect(panelSource).toContain('setChannelEnabled(type, nextEnabled)');
    expect(panelSource).toContain('applyChannelToggleResult(type, result)');
    expect(panelSource).toContain('result.desiredEnabled');
    expect(panelSource).toContain('showLoading: false');
    expect(panelSource).toContain('isTogglingChannel={togglingChannel === selectedChannel}');
    expect(detailSource).toContain("'remote.disableChannel'");
    expect(detailSource).toContain("'remote.enableChannel'");
    expect(detailSource).toContain('getChannelState(channel)');
    expect(channelStateSource).toContain("return 'disabled'");
    expect(detailSource).toContain('<Switch');
    expect(detailSource).toContain('checked={channel.enabled}');
    expect(detailSource).toContain('onCheckedChange={onToggleChannel}');
  });

  it('enables DingTalk and WeCom Webhook modes and persists their receive modes', () => {
    const panelSource = readFileSync(panelPath, 'utf8');
    const detailSource = readFileSync(detailPath, 'utf8');

    expect(panelSource).toContain('receiveMode: dingtalkReceiveMode');
    expect(detailSource).toContain("onDingtalkReceiveModeChange('webhook')");
    expect(detailSource).toContain('/webhook/${channel.type}');
    expect(panelSource).toContain('receiveMode: wecomReceiveMode');
    expect(panelSource).toContain('webhookEncodingAESKey: wecomWebhookEncodingAESKey');
    expect(detailSource).toContain("onWecomReceiveModeChange('webhook')");
    expect(detailSource).toContain('wecom-webhook-aes-key');
  });

  it('saves Feishu and gateway settings independently to avoid duplicate restarts', () => {
    const source = readFileSync(panelPath, 'utf8');
    const feishuSaveBody = source.slice(
      source.indexOf('async function saveFeishuConfig()'),
      source.indexOf('async function approvePairing(')
    );

    expect(feishuSaveBody).toContain('updateFeishuConfig');
    expect(feishuSaveBody).not.toContain('updateGatewayConfig');
  });

  it('checks the administrator approval result before reporting success', () => {
    const source = readFileSync(panelPath, 'utf8');
    const approvalBody = source.slice(
      source.indexOf('async function approvePairing('),
      source.indexOf('async function rejectPairing(')
    );

    expect(approvalBody).toContain('if (!result.success)');
    expect(approvalBody).toContain("setError({ key: 'remote.approveFailed' })");
  });

  it('shows the pairing empty state when any supported channel uses pairing', () => {
    const source = readFileSync(panelPath, 'utf8');

    expect(source).toContain("wecomDmPolicy === 'pairing'");
    expect(source).toContain('showEmpty={status?.running && isPairingEnabled}');
  });
});
