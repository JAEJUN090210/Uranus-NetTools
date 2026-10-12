import { build } from 'esbuild';

// 단일 실행 파일(SEA)로 감쌀 수 있도록 의존성까지 하나의 CommonJS 파일로 묶습니다.
await build({
  entryPoints: ['src/index.ts'],
  outfile: 'dist/unt.cjs',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  banner: { js: '#!/usr/bin/env node' },
  logLevel: 'info',
});
