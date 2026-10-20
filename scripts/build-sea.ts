import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';

import pkg from '../package.json' with { type: 'json' };

// 사용법: npm run build && npm run build:sea
// 지금 실행 중인 node로 단독 실행 파일(SEA)을 만들고, 배포용 압축 파일을 dist/release에 담습니다.
// 실행 파일 안에는 이 node가 그대로 들어가므로 대상 운영체제·CPU에서 실행해야 합니다.

type Inject = (
  filename: string,
  resourceName: string,
  resourceData: Buffer,
  options: { sentinelFuse: string; machoSegmentName?: string },
) => Promise<void>;

// Node 문서에 정해진 값입니다. 이 문자열로 실행 파일 안의 SEA 자리를 찾습니다.
const SENTINEL_FUSE = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2';
const ROOT = resolve(import.meta.dirname, '..');
const BUNDLE = join(ROOT, 'dist', 'unt.cjs');
const WORK = join(ROOT, 'dist', 'sea');
const RELEASE = join(ROOT, 'dist', 'release');
const SOURCE_URL = `https://github.com/JAEJUN090210/Uranus-NetTools/tree/v${pkg.version}`;

const windows = process.platform === 'win32';
const macos = process.platform === 'darwin';

/** 배포 파일 이름에 쓰는 대상 이름입니다. (예: linux-arm64, macos-x64) */
function targetName(): string {
  const os = windows ? 'windows' : macos ? 'macos' : process.platform;
  return `${os}-${process.arch}`;
}

function run(file: string, args: readonly string[]): string {
  return execFileSync(file, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
}

/**
 * Node 실행 파일 옆의 LICENSE에는 V8, OpenSSL, ICU 같은 Node에 들어 있는 모든 구성 요소의 라이선스가 모여 있습니다.
 * 실행 파일에 Node를 함께 담아 배포하므로 이 고지도 함께 넣어야 합니다.
 */
function nodeLicense(): string {
  const prefix = dirname(process.execPath);
  for (const candidate of [join(prefix, 'LICENSE'), join(prefix, '..', 'LICENSE')]) {
    if (existsSync(candidate)) {
      return readFileSync(candidate, 'utf8');
    }
  }
  throw new Error(`Node.js LICENSE not found next to ${process.execPath}`);
}

function thirdPartyNotices(): string {
  const commander = readFileSync(join(ROOT, 'node_modules', 'commander', 'LICENSE'), 'utf8');
  const rule = '='.repeat(78);
  return [
    `Uranus-NetTools ${pkg.version} (${targetName()})`,
    `Source code: ${SOURCE_URL}`,
    '',
    'This executable bundles the components below. Uranus-NetTools itself is',
    'licensed under the GNU General Public License v3.0 or later (see LICENSE).',
    '',
    rule,
    `Node.js ${process.version}`,
    rule,
    nodeLicense().trim(),
    '',
    rule,
    'commander',
    rule,
    commander.trim(),
    '',
  ].join('\n');
}

async function buildExecutable(): Promise<string> {
  if (!existsSync(BUNDLE)) {
    throw new Error('dist/unt.cjs is missing; run `npm run build` first');
  }
  rmSync(WORK, { recursive: true, force: true });
  mkdirSync(WORK, { recursive: true });

  const blob = join(WORK, 'sea-prep.blob');
  const config = join(WORK, 'sea-config.json');
  writeFileSync(
    config,
    JSON.stringify({
      main: BUNDLE,
      output: blob,
      // 실행할 때마다 "실험 기능" 경고가 나오지 않게 합니다.
      disableExperimentalSEAWarning: true,
      // 같은 운영체제에서 만들고 쓰므로 코드 캐시를 넣어 시작을 빠르게 합니다.
      useCodeCache: true,
    }),
  );
  run(process.execPath, ['--experimental-sea-config', config]);

  const executable = join(WORK, windows ? 'unt.exe' : 'unt');
  copyFileSync(process.execPath, executable);
  if (!windows) {
    chmodSync(executable, 0o755);
  }
  // macOS는 서명이 있으면 내용을 바꿀 수 없으므로 먼저 지우고, 주입한 뒤 임시 서명을 다시 합니다.
  if (macos) {
    run('codesign', ['--remove-signature', executable]);
  }

  const { inject } = createRequire(import.meta.url)('postject') as { inject: Inject };
  await inject(executable, 'NODE_SEA_BLOB', readFileSync(blob), {
    sentinelFuse: SENTINEL_FUSE,
    ...(macos ? { machoSegmentName: 'NODE_SEA' } : {}),
  });
  if (macos) {
    run('codesign', ['--sign', '-', executable]);
  }

  // 만든 실행 파일이 실제로 뜨는지, 버전이 맞는지 확인합니다.
  const version = run(executable, ['--version']).trim();
  if (version !== pkg.version) {
    throw new Error(`the executable reports ${version}, expected ${pkg.version}`);
  }
  return executable;
}

/** Windows는 zip, 그 밖에는 tar.gz로 묶습니다. 압축 파일 맨 위에 실행 파일이 바로 오게 합니다. */
function archive(executable: string): string {
  const name = `unt-${pkg.version}-${targetName()}`;
  const stage = join(WORK, name);
  mkdirSync(stage, { recursive: true });
  copyFileSync(executable, join(stage, windows ? 'unt.exe' : 'unt'));
  copyFileSync(join(ROOT, 'LICENSE'), join(stage, 'LICENSE'));
  writeFileSync(join(stage, 'THIRD-PARTY-NOTICES.txt'), thirdPartyNotices());

  mkdirSync(RELEASE, { recursive: true });
  const output = join(RELEASE, `${name}${windows ? '.zip' : '.tar.gz'}`);
  rmSync(output, { force: true });
  // "."로 묶으면 항목 이름 앞에 ./가 붙어서, 파일을 하나씩 적어 맨 위에 바로 놓이게 합니다.
  const files = [windows ? 'unt.exe' : 'unt', 'LICENSE', 'THIRD-PARTY-NOTICES.txt'];
  if (windows) {
    // Git Bash의 GNU tar는 zip을 못 만들어서 Windows에 들어 있는 bsdtar를 직접 씁니다.
    const tar = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe');
    run(tar, ['-a', '-c', '-f', output, '-C', stage, ...files]);
  } else {
    run('tar', ['-czf', output, '-C', stage, ...files]);
  }
  return output;
}

const executable = await buildExecutable();
const output = archive(executable);
const digest = createHash('sha256').update(readFileSync(output)).digest('hex');
console.log(`${output}\n  sha256 ${digest}`);
