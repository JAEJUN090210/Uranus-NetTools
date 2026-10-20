import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import pkg from '../package.json' with { type: 'json' };
import { APT_COMPONENT, APT_KEY_FILE, APT_SUITE, PAGES_URL } from './lib/pages';

// 사용법: tsx scripts/build-site.ts   (apt 저장소는 build-apt-repo.ts가 따로 만듭니다)
// GitHub Pages에 올릴 첫 페이지(index.html)를 쓰고, 설치 스크립트를 dist/site에 복사합니다.
// 사이트에는 install.sh, install.ps1, apt/가 함께 올라갑니다.

const ROOT = resolve(import.meta.dirname, '..');
const SITE = join(ROOT, 'dist', 'site');
const REPOSITORY_URL = 'https://github.com/JAEJUN090210/Uranus-NetTools';

mkdirSync(SITE, { recursive: true });
for (const script of ['install.sh', 'install.ps1']) {
  copyFileSync(join(ROOT, 'scripts', script), join(SITE, script));
}

function escapeHtml(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

interface Method {
  title: string;
  commands: readonly string[];
  note: string;
}

const methods: readonly Method[] = [
  {
    title: 'Linux and macOS',
    commands: [`curl -fsSL ${PAGES_URL}/install.sh | sh`],
    note: 'Installs to ~/.local/bin without sudo and adds it to your PATH. Run it again to update.',
  },
  {
    title: 'Windows (PowerShell)',
    commands: [`irm ${PAGES_URL}/install.ps1 | iex`],
    note: 'Installs to %LOCALAPPDATA%\\Programs\\unt without administrator rights and adds it to your PATH. Run it again to update.',
  },
  {
    title: 'Ubuntu and Debian (amd64, arm64)',
    commands: [
      'sudo install -d -m 0755 /etc/apt/keyrings',
      `curl -fsSL ${PAGES_URL}/apt/${APT_KEY_FILE} | sudo tee /etc/apt/keyrings/${APT_KEY_FILE} > /dev/null`,
      `echo "deb [signed-by=/etc/apt/keyrings/${APT_KEY_FILE}] ${PAGES_URL}/apt ${APT_SUITE} ${APT_COMPONENT}" | sudo tee /etc/apt/sources.list.d/uranus-nettools.list`,
      'sudo apt update',
      'sudo apt install unt',
    ],
    note: 'Later versions arrive with sudo apt upgrade.',
  },
  {
    title: 'macOS (Homebrew)',
    commands: ['brew install jaejun090210/tap/unt'],
    note: 'Later versions arrive with brew upgrade.',
  },
];

const body = methods
  .map(
    ({ title, commands, note }) =>
      `<h2>${escapeHtml(title)}</h2>\n<pre>${escapeHtml(commands.join('\n'))}</pre>\n<p>${escapeHtml(note)}</p>`,
  )
  .join('\n');

writeFileSync(
  join(SITE, 'index.html'),
  `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Uranus-NetTools</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 46rem; margin: 2rem auto; padding: 0 1rem; line-height: 1.5; color: #1f2328; background: #fff; }
  pre { background: #f6f8fa; padding: 1rem; overflow-x: auto; border-radius: 6px; }
  @media (prefers-color-scheme: dark) { body { color: #e6edf3; background: #0d1117; } pre { background: #161b22; } a { color: #4493f8; } }
</style>
</head>
<body>
<h1>Uranus-NetTools</h1>
<p><code>unt</code> ${pkg.version} is a cross-platform command-line network toolkit: ping, trace, scan, sweep, dns, whois, ip, geoip, info, http, cert, local and conns.
Source code and documentation are on <a href="${REPOSITORY_URL}">GitHub</a>.</p>
${body}
<h2>Other ways</h2>
<p>Download the archive for your platform from the <a href="${REPOSITORY_URL}/releases/latest">latest release</a>, or read the <a href="${REPOSITORY_URL}#installation">installation guide</a>.</p>
</body>
</html>
`,
);

console.log(`site for unt ${pkg.version} written to ${SITE}`);
