import * as fs from 'node:fs';
import { set_fs } from 'xlsx';

// SheetJS 0.20's ESM entry requires explicit filesystem registration in Node.
set_fs(fs);

export * from 'xlsx';
