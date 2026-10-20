import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import pkg from '../package.json' with { type: 'json' };

// 사용법: tsx scripts/winget-manifest.ts
// dist/release의 Windows 압축 파일로 winget 매니페스트 세 개를 dist/winget에 만듭니다.
// winget-pkgs에 처음 올릴 때 이 파일을 씁니다. 그 뒤로는 릴리스 워크플로의 winget-releaser가 이를 바탕으로 갱신합니다.

const ROOT = resolve(import.meta.dirname, '..');
const RELEASE = join(ROOT, 'dist', 'release');
const IDENTIFIER = 'JAEJUN090210.UranusNetTools';
const HOMEPAGE = 'https://github.com/JAEJUN090210/Uranus-NetTools';
/** winget-releaser가 쓰는 komac과 같은 판을 써서, 이후 자동 갱신과 형식을 맞춥니다. */
const MANIFEST_VERSION = '1.10.0';

const archive = `unt-${pkg.version}-windows-x64.zip`;
const archivePath = join(RELEASE, archive);
if (!existsSync(archivePath)) {
  throw new Error(`${archive} is missing from dist/release`);
}
// winget은 체크섬을 대문자 16진수로 적습니다.
const sha256 = createHash('sha256').update(readFileSync(archivePath)).digest('hex').toUpperCase();

/** winget-pkgs의 폴더 규칙입니다. (manifests/<첫 글자>/<게시자>/<이름>/<버전>) */
const [publisherId = '', packageId = ''] = IDENTIFIER.split('.');
const output = join(
  ROOT,
  'dist',
  'winget',
  'manifests',
  publisherId.charAt(0).toLowerCase(),
  publisherId,
  packageId,
  pkg.version,
);

function header(type: string): string {
  return `# yaml-language-server: $schema=https://aka.ms/winget-manifest.${type}.${MANIFEST_VERSION}.schema.json\n`;
}

const common = `PackageIdentifier: ${IDENTIFIER}\nPackageVersion: ${pkg.version}\n`;
const footer = (type: string) => `ManifestType: ${type}\nManifestVersion: ${MANIFEST_VERSION}\n`;

const files: Record<string, string> = {
  [`${IDENTIFIER}.yaml`]: `${header('version')}
${common}DefaultLocale: en-US
${footer('version')}`,

  [`${IDENTIFIER}.installer.yaml`]: `${header('installer')}
${common}InstallerType: zip
NestedInstallerType: portable
NestedInstallerFiles:
- RelativeFilePath: unt.exe
  PortableCommandAlias: unt
Commands:
- unt
ReleaseDate: ${new Date().toISOString().slice(0, 10)}
Installers:
- Architecture: x64
  InstallerUrl: ${HOMEPAGE}/releases/download/v${pkg.version}/${archive}
  InstallerSha256: ${sha256}
${footer('installer')}`,

  [`${IDENTIFIER}.locale.en-US.yaml`]: `${header('defaultLocale')}
${common}PackageLocale: en-US
Publisher: ${pkg.author}
PublisherUrl: https://github.com/JAEJUN090210
PublisherSupportUrl: ${HOMEPAGE}/issues
Author: ${pkg.author}
PackageName: Uranus-NetTools
PackageUrl: ${HOMEPAGE}
License: GPL-3.0-or-later
LicenseUrl: ${HOMEPAGE}/blob/main/LICENSE
ShortDescription: Cross-platform command-line network toolkit.
Description: |-
  Uranus-NetTools (unt) puts everyday network diagnostic, scanning and lookup tools behind one command:
  ping, trace, scan, sweep, dns, whois, ip, geoip, info, http, cert, local and conns.
  Run a single command for scripts and pipes, or start an interactive shell. It needs no administrator rights.
Moniker: unt
Tags:
${pkg.keywords.map((keyword) => `- ${keyword}`).join('\n')}
ReleaseNotesUrl: ${HOMEPAGE}/releases/tag/v${pkg.version}
${footer('defaultLocale')}`,
};

rmSync(join(ROOT, 'dist', 'winget'), { recursive: true, force: true });
mkdirSync(output, { recursive: true });
for (const [name, content] of Object.entries(files)) {
  writeFileSync(join(output, name), content);
}
console.log(output);
