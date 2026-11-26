import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const agentRunnerPath = path.resolve(process.cwd(), 'src/main/agent/agent-runner.ts');
const agentRunnerContent = readFileSync(agentRunnerPath, 'utf8');
const bridgePath = path.resolve(process.cwd(), 'src/main/agent/agent-runner-event-bridge.ts');
const bridgeContent = readFileSync(bridgePath, 'utf8');
const toolsPath = path.resolve(process.cwd(), 'src/main/agent/agent-runner-tools.ts');
const toolsContent = readFileSync(toolsPath, 'utf8');
const mainAgentPromptPath = path.resolve(process.cwd(), 'src/main/prompts/main-agent-system.txt');
const mainAgentPromptContent = readFileSync(mainAgentPromptPath, 'utf8');

describe('AgentRunner sophron SDK integration', () => {
  it('uses standard markdown link guidance for sources citations', () => {
    expect(mainAgentPromptContent).toContain(
      'otherwise use standard Markdown links: [Title](https://example.com/page)'
    );
  });

  it('summarizes noisy SDK message updates instead of logging every text delta', () => {
    expect(bridgeContent).toContain('streamEventCounts = new Map<string, number>();');
    expect(bridgeContent).toContain("updateType !== 'text_delta'");
    expect(bridgeContent).toContain("updateType !== 'thinking_delta'");
    expect(bridgeContent).toContain("'[AgentRunner] Event: message_end'");
    expect(bridgeContent).toContain('messageUpdateCounts: this.getStreamEventSummary()');
    expect(bridgeContent).toContain("if (process.env.COWORK_LOG_SDK_MESSAGES_FULL === '1') {");
    expect(bridgeContent).toContain("'[AgentRunner] message_end raw message:'");
  });

  it('reuses the shared user-facing error helper', () => {
    expect(agentRunnerContent).toContain(
      "import { toUserFacingErrorText } from './agent-runner-message-end'"
    );
    expect(bridgeContent).toContain(
      "import { resolveMessageEndPayload, toUserFacingErrorText } from './agent-runner-message-end'"
    );
    expect(agentRunnerContent).toContain(
      'const errorText = toUserFacingErrorText(toErrorText(error));'
    );
  });

  it('uses pi DefaultResourceLoader with additionalSkillPaths and appendSystemPrompt', () => {
    expect(agentRunnerContent).toContain('additionalSkillPaths: skillPaths');
    expect(agentRunnerContent).toContain('appendSystemPrompt: coworkAppendPrompt');
    expect(agentRunnerContent).not.toContain('systemPromptOverride');
  });

  it('recreates cached pi sessions when the runtime signature changes', () => {
    expect(agentRunnerContent).toContain(
      "import { buildPiSessionRuntimeSignature } from './pi-session-runtime'"
    );
    expect(agentRunnerContent).toContain(
      'const sessionRuntimeSignature = buildPiSessionRuntimeSignature({'
    );
    expect(agentRunnerContent).toContain(
      'cachedSession.runtimeSignature !== sessionRuntimeSignature'
    );
    expect(agentRunnerContent).toContain('Runtime changed, recreating cached pi session:');
    expect(agentRunnerContent).toContain('runtimeSignature: sessionRuntimeSignature');
  });

  it('uses the normalized route protocol so openrouter follows the openai-compatible path', () => {
    const modelSource = readFileSync(
      path.join(path.dirname(agentRunnerPath), 'agent-runner-model.ts'),
      'utf8'
    );
    expect(agentRunnerContent).toContain('await resolveRunModel(');
    expect(modelSource).toContain('const configProtocol = resolvePiRouteProtocol(');
    expect(modelSource).toContain('resolveSyntheticPiModelFallback');
  });

  it('nudges the model to proceed with reasonable assumptions', () => {
    expect(mainAgentPromptContent).toContain('proceed immediately with reasonable assumptions');
    expect(mainAgentPromptContent).toContain('within two days');
    expect(mainAgentPromptContent).toContain('most recent two relevant publication days');
  });

  it('routes MCP image results through structured helpers instead of stringifying base64 into text', () => {
    expect(toolsContent).toContain(
      "import { normalizeMcpToolResultForModel } from './tool-result-utils'"
    );
    expect(bridgeContent).toContain('normalizeToolExecutionResultForUi');
    expect(toolsContent).toContain(
      'const normalizedResult = normalizeMcpToolResultForModel(result);'
    );
    expect(bridgeContent).toContain(
      'const normalizedToolResult = normalizeToolExecutionResultForUi(event.result);'
    );
    expect(agentRunnerContent).not.toContain('else textParts.push(JSON.stringify(part));');
    expect(agentRunnerContent).not.toContain(": JSON.stringify(event.result || '');");
    expect(bridgeContent).not.toContain('else textParts.push(JSON.stringify(part));');
    expect(bridgeContent).not.toContain(": JSON.stringify(event.result || '');");
  });

  it('persists assistant model metadata for pi-ai thinking replay', () => {
    expect(agentRunnerContent).toContain('api: piModel.api');
    expect(agentRunnerContent).toContain('provider: piModel.provider');
    expect(agentRunnerContent).toContain('model: piModel.id');
  });

  it('does not reference removed AskUserQuestion or TodoWrite tools', () => {
    expect(agentRunnerContent).not.toContain('AskUserQuestion');
    expect(agentRunnerContent).not.toContain('TodoWrite');
    expect(agentRunnerContent).not.toContain('pendingQuestions');
  });

  it('chat-first behavioral rules are present', () => {
    expect(mainAgentPromptContent).toContain('CHAT FIRST');
    expect(mainAgentPromptContent).toContain(
      'Do NOT create, write, or edit files unless the user explicitly asks'
    );
    expect(mainAgentPromptContent).toContain('START DOING IT');
  });
});
