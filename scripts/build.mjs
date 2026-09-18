import { cp, mkdir, rm } from 'node:fs/promises';
await rm('dist', { recursive: true, force: true });
await mkdir('dist');
for (const path of ['index.html', 'src', 'public']) await cp(path, `dist/${path}`, { recursive: true });
console.log('Built static app → dist/ (no runtime dependencies)');
