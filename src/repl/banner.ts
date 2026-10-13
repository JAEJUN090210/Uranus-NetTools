import type { Colors } from '../ui/colors';

const LOGO = [
  ' _   _  ____      _     _   _  _   _  ____',
  '| | | ||  _ \\    / \\   | \\ | || | | |/ ___|',
  '| | | || |_) |  / _ \\  |  \\| || | | |\\___ \\',
  '| |_| ||  _ <  / ___ \\ | |\\  || |_| | ___) |',
  ' \\___/ |_| \\_\\/_/   \\_\\|_| \\_| \\___/ |____/',
];

export function renderBanner(version: string, colors: Colors, unicode: boolean): string {
  const dash = unicode ? '—' : '-';
  return [
    ...LOGO.map((line) => colors.cyan(line)),
    `NetTools v${version} ${dash} type 'help' for commands, 'exit' to quit`,
  ].join('\n');
}
