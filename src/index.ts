import { createProgram } from './cli/program';

createProgram()
  .parseAsync(process.argv)
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
