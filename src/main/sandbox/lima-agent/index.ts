#!/usr/bin/env node
import { startSandboxAgent } from '../guest-agent';

startSandboxAgent('Lima').catch((error) => {
  console.error('Failed to start sandbox agent:', error);
  process.exit(1);
});
