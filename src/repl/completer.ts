import type { Command } from 'commander';

/** commander 명령이 아니라 셸이 직접 처리하는 명령입니다. */
export const SHELL_COMMANDS = ['help', 'clear', 'exit', 'quit'] as const;

export type Completer = (line: string) => [string[], string];

export function namesOf(command: Command): string[] {
  return [command.name(), ...command.aliases()];
}

function flagsOf(command: Command): string[] {
  return command.options
    .flatMap((option) => [option.long, option.short])
    .filter((flag) => flag !== undefined);
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

/** 첫 단어는 명령 이름으로, 그 뒤 '-'로 시작하는 단어는 해당 명령과 전역 옵션으로 완성합니다. */
export function createCompleter(program: Command): Completer {
  const commandNames = unique(program.commands.flatMap(namesOf));
  const firstWords = unique([...SHELL_COMMANDS, ...commandNames]);
  const globalFlags = [...flagsOf(program), '--help'];

  return (line) => {
    const words = line.trimStart().split(/\s+/);
    const [first = ''] = words;
    const current = words.at(-1) ?? '';
    const match = (candidates: readonly string[]): [string[], string] => [
      candidates.filter((candidate) => candidate.startsWith(current)),
      current,
    ];

    if (words.length === 1) {
      return match(firstWords);
    }
    if (current.startsWith('-')) {
      const command = program.commands.find((candidate) => namesOf(candidate).includes(first));
      return match(unique([...(command ? flagsOf(command) : []), ...globalFlags]));
    }
    if (first === 'help' && words.length === 2) {
      return match(commandNames);
    }
    return [[], current];
  };
}
