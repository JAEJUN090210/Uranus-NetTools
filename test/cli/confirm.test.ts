import { PassThrough } from 'node:stream';

import { describe, expect, it } from 'vitest';

import { createTerminalConfirm, isYes } from '../../src/cli/confirm';

describe('isYes', () => {
  it.each(['y', 'Y', 'yes', ' YES '])('accepts %j', (answer) => {
    expect(isYes(answer)).toBe(true);
  });

  it.each(['', 'n', 'no', 'yep', 'y es'])('declines %j', (answer) => {
    expect(isYes(answer)).toBe(false);
  });
});

describe('createTerminalConfirm', () => {
  function setup(signal = new AbortController().signal) {
    const input = new PassThrough();
    const output = new PassThrough();
    let screen = '';
    output.on('data', (chunk: Buffer) => {
      screen += chunk.toString();
    });
    const confirm = createTerminalConfirm({ input, output, signal, onInterrupt: () => undefined });
    return { input, confirm, screen: () => screen };
  }

  it('asks the question and reads the answer', async () => {
    const { input, confirm, screen } = setup();

    const answer = confirm('Continue? [y/N] ');
    input.write('yes\n');

    expect(await answer).toBe(true);
    expect(screen()).toContain('Continue? [y/N] ');
  });

  it('treats a bare Enter as no', async () => {
    const { input, confirm } = setup();

    const answer = confirm('Continue? [y/N] ');
    input.write('\n');

    expect(await answer).toBe(false);
  });

  it('is rejected when cancelled', async () => {
    const controller = new AbortController();
    const { confirm } = setup(controller.signal);

    const answer = confirm('Continue? [y/N] ');
    controller.abort();

    await expect(answer).rejects.toMatchObject({ name: 'AbortError' });
  });
});
