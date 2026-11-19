import { chromium } from '@playwright/test';
import { cp, mkdir, rm, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

// Package the same Chromium revision used to verify provider networking.
const executable = chromium.executablePath();
try { await stat(executable); }
catch { throw new Error('Chromium is missing. Run npx playwright install chromium before preparing the desktop build.'); }
const directory = resolve('src-tauri/provider-browser');
if (dirname(directory) !== resolve('src-tauri')) throw new Error('Invalid browser staging directory');
await rm(directory, { recursive: true, force: true });
await mkdir(directory, { recursive: true });
await cp(dirname(executable), directory, { recursive: true });
console.log('Prepared the provider browser.');
