import { readdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
for (const dir of ['src', 'scripts', 'tests']) for (const name of await readdir(dir)) {
  if (/\.m?js$/.test(name)) execFileSync(process.execPath, ['--check', `${dir}/${name}`], { stdio: 'inherit' });
}
console.log('All JavaScript syntax checks passed.');
