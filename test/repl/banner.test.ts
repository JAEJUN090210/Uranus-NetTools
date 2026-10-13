import { describe, expect, it } from 'vitest';

import { createColors } from '../../src/ui/colors';
import { renderBanner } from '../../src/repl/banner';

describe('renderBanner', () => {
  it('shows the logo with the version and how to get help', () => {
    const lines = renderBanner('1.2.3', createColors(false), true).split('\n');

    expect(lines).toHaveLength(6);
    expect(lines.at(-1)).toBe("NetTools v1.2.3 — type 'help' for commands, 'exit' to quit");
  });

  it('avoids the em dash on consoles without Unicode glyphs', () => {
    expect(renderBanner('1.2.3', createColors(false), false)).toContain('v1.2.3 - type');
  });
});
