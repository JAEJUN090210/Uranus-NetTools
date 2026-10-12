import { Command, Option } from 'commander';

import pkg from '../../package.json' with { type: 'json' };
import { createPingCommand } from '../commands/ping';
import { createColors, shouldUseColor } from '../ui/colors';
import type { Runtime } from './runtime';

export type CommandFactory = (runtime: Runtime) => Command;

export interface CommandGroup {
  readonly heading: string;
  readonly commands: readonly CommandFactory[];
}

/** 도움말에 보여줄 명령 분류입니다. 새 명령은 알맞은 분류의 commands에 추가합니다. */
export const COMMAND_GROUPS: readonly CommandGroup[] = [
  { heading: 'Diagnostics:', commands: [createPingCommand] },
  { heading: 'Scanning:', commands: [] },
  { heading: 'Lookup:', commands: [] },
  { heading: 'Local:', commands: [] },
];

export function createProgram(
  runtime: Runtime,
  groups: readonly CommandGroup[] = COMMAND_GROUPS,
): Command {
  const errorColors = createColors(shouldUseColor(runtime.stderr, runtime.env));
  const program = new Command('unt')
    .description(pkg.description)
    .version(pkg.version)
    .option('--json', 'print results as JSON')
    .addOption(new Option('-q, --quiet', 'print results only, without hints').conflicts('verbose'))
    .option('--verbose', 'print details such as the system commands being run')
    // 대화형 셸 안에서도 쓸 수 있도록 commander가 프로세스를 끝내는 대신 예외를 던지게 합니다.
    .exitOverride()
    .configureOutput({
      writeOut: (text) => runtime.stdout.write(text),
      writeErr: (text) => runtime.stderr.write(text),
      outputError: (text, write) => {
        write(errorColors.red(text));
      },
    })
    .showHelpAfterError("(run 'unt --help' for usage)");

  for (const group of groups) {
    program.commandsGroup(group.heading);
    for (const createCommand of group.commands) {
      // addCommand는 .command()와 달리 부모 설정을 물려주지 않으므로 직접 복사합니다.
      program.addCommand(createCommand(runtime).copyInheritedSettings(program));
    }
  }
  return program;
}
