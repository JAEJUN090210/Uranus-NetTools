import { describe, expect, it } from 'vitest';

import { renderSparkline } from '../../src/ui/sparkline';

describe('renderSparkline', () => {
  it('scales values between the lowest and the highest bar', () => {
    expect(renderSparkline([1, 8, 4.5], 'x')).toBe('▁█▅');
  });

  it('marks values that are missing', () => {
    expect(renderSparkline([1, undefined, 2], 'x')).toBe('▁x█');
  });

  it('uses the lowest bar when every value is the same', () => {
    expect(renderSparkline([5, 5], 'x')).toBe('▁▁');
  });

  it('draws only markers when there are no values', () => {
    expect(renderSparkline([undefined, undefined], 'x')).toBe('xx');
  });

  it('keeps only the most recent values', () => {
    expect(
      renderSparkline(
        Array.from({ length: 100 }, () => 1),
        'x',
        60,
      ),
    ).toHaveLength(60);
  });
});
