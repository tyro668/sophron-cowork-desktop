import { registerBunOAuthFlows } from '@earendil-works/pi-ai/bun-oauth';

// Despite its name, this SDK entry point only registers static OAuth loaders
// (no Bun APIs). Electron's bundled main process needs them too: the default
// variable imports resolve relative to the bundle instead of the SDK package.
registerBunOAuthFlows();
