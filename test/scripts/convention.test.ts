import { describe, expect, it } from 'vitest';

import { extractHeader, validateHeader } from '../../scripts/lib/convention';

describe('validateHeader', () => {
  it.each([
    '📝 :: README 파일 수정',
    '🐛 :: [MainPage] 헤더가 안보이는 버그 수정',
    '🐛 :: (#19)[FeedServiceImpl] 피드 버그 로직 수정',
    '⚡️ :: [ping] TCP ping 옵션 추가',
    '⚡ :: [ping] 변형 선택자 없는 이모지 허용',
    '🚀 :: v1.0.0',
    `📝 :: ${'가'.repeat(50)}`,
    `📝 :: ${'가'.repeat(49)}👨‍👩‍👧`,
    'fixup! 📝 :: README 파일 수정',
  ])('accepts "%s"', (header) => {
    expect(validateHeader(header)).toEqual([]);
  });

  it.each([
    ['add readme', '형식'],
    ['📝: README 수정', '형식'],
    ['📝 ::README 수정', '형식'],
    ['✨ :: 기능 추가', '타입'],
    ['📝 :: ', '비어'],
    ['📝 :: README update', '한국어'],
    ['🐛 :: 헤더 버그를 수정했다', '명령형'],
    [`📝 :: ${'가'.repeat(51)}`, '50자'],
  ])('rejects "%s"', (header, reason) => {
    expect(validateHeader(header).join('\n')).toContain(reason);
  });
});

describe('validateHeader for pull request titles', () => {
  const pullRequest = true;

  it('accepts a merge title with an issue number', () => {
    expect(validateHeader('🔀 :: (#12) TCP ping 기능 추가', { pullRequest })).toEqual([]);
  });

  it('requires the merge type', () => {
    const errors = validateHeader('📝 :: (#12) README 수정', { pullRequest });

    expect(errors.join('\n')).toContain('🔀');
  });

  it('requires the issue number right after the separator', () => {
    const errors = validateHeader('🔀 :: TCP ping 기능 추가 (#12)', { pullRequest });

    expect(errors.join('\n')).toContain('이슈 번호');
  });

  it('does not skip autosquash prefixes', () => {
    expect(validateHeader('fixup! 🔀 :: (#12) TCP ping 기능 추가', { pullRequest })).not.toEqual(
      [],
    );
  });
});

describe('extractHeader', () => {
  it('skips leading blank lines and comments', () => {
    expect(extractHeader('\n# 주석\n📝 :: README 수정\n\n본문\n')).toBe('📝 :: README 수정');
  });

  it('handles CRLF line endings', () => {
    expect(extractHeader('📝 :: README 수정\r\n\r\n본문\r\n')).toBe('📝 :: README 수정');
  });

  it('ignores everything below the scissors line', () => {
    const message = '# ------------------------ >8 ------------------------\n📝 :: README 수정\n';

    expect(extractHeader(message)).toBe('');
  });
});
