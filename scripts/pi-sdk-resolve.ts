// OAuth flow registration and ModelRuntime must share the same SDK instance,
// even when npm installs a nested copy under pi-coding-agent.
export const piSdkResolve = {
  dedupe: ['@earendil-works/pi-ai', '@earendil-works/pi-agent-core'],
};
