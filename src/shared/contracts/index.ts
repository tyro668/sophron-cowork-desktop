/**
 * Cross-process contract layer. main, preload, and renderer may depend on this
 * module only (plus leaf modules under shared/). shared/ must never import
 * from main/ or renderer/.
 */
export * from './config';
export * from './session';
export * from './data';
export * from './ipc';
export * from './remote';
export * from './mcp';
export * from './skills';
export * from './memory';
export * from './schedule';
export * from './update';
export * from './automation';
