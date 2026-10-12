export interface Symbols {
  readonly success: string;
  readonly failure: string;
  readonly info: string;
  readonly warning: string;
  readonly prompt: string;
}

const UNICODE_SYMBOLS: Symbols = {
  success: '✔',
  failure: '✖',
  info: '▸',
  warning: '⚠',
  prompt: '❯',
};

const ASCII_SYMBOLS: Symbols = {
  success: '[OK]',
  failure: '[FAIL]',
  info: '>',
  warning: '[!]',
  prompt: '>',
};

/**
 * 유니코드 기호를 제대로 그릴 수 있는 터미널인지 추측합니다.
 * 레거시 Windows 콘솔(conhost)과 리눅스 가상 콘솔은 글꼴에 기호가 없어 깨지므로 ASCII를 씁니다.
 */
export function supportsUnicode(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): boolean {
  if (platform !== 'win32') {
    return env.TERM !== 'linux';
  }
  return (
    env.WT_SESSION !== undefined || // Windows Terminal
    env.TERM_PROGRAM === 'vscode' ||
    env.TERMINAL_EMULATOR === 'JetBrains-JediTerm' ||
    env.ConEmuTask === '{cmd::Cmder}' ||
    env.MSYSTEM !== undefined || // Git Bash(mintty)
    env.TERM === 'xterm-256color' ||
    env.TERM === 'alacritty'
  );
}

export function getSymbols(unicode: boolean): Symbols {
  return unicode ? UNICODE_SYMBOLS : ASCII_SYMBOLS;
}
