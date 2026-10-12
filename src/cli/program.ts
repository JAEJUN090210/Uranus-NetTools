import { Command } from 'commander';

import pkg from '../../package.json' with { type: 'json' };

export function createProgram(): Command {
  return new Command().name('unt').description(pkg.description).version(pkg.version);
}
