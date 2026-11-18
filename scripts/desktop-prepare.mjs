import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
const target = process.env.TAURI_ENV_TARGET_TRIPLE || 'x86_64-pc-windows-msvc';
if (target !== 'x86_64-pc-windows-msvc') throw new Error('Desktop builds currently support Windows x64');
mkdirSync('src-tauri/binaries', {recursive:true});
execFileSync('bun', ['build','--compile','--target=bun-windows-x64','server/desktop.ts','--outfile', 'src-tauri/binaries/moewatch-server-' + target + '.exe'], {stdio:'inherit'});
