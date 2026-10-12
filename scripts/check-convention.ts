import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

import { COMMIT_TYPES, extractHeader, validateHeader } from './lib/convention';

// 사용법:
//   tsx scripts/check-convention.ts --file <커밋 메시지 파일>   (commit-msg 훅)
//   tsx scripts/check-convention.ts --pr-title "<PR 제목>"     (CI)
function main(): number {
  const { values } = parseArgs({
    options: {
      file: { type: 'string' },
      'pr-title': { type: 'string' },
    },
  });

  const prTitle = values['pr-title'];
  const pullRequest = prTitle !== undefined;
  let header: string;
  if (prTitle !== undefined) {
    header = prTitle;
  } else if (values.file !== undefined) {
    header = extractHeader(readFileSync(values.file, 'utf8'));
  } else {
    console.error('사용법: check-convention --file <커밋 메시지 파일> | --pr-title <PR 제목>');
    return 2;
  }

  const errors = validateHeader(header, { pullRequest });
  if (errors.length === 0) {
    return 0;
  }

  console.error(
    [
      `✖ ${pullRequest ? 'PR 제목이' : '커밋 메시지가'} 규칙에 맞지 않습니다.`,
      '',
      `  입력: ${header === '' ? '(비어 있음)' : header}`,
      ...errors.map((error) => `  - ${error}`),
      '',
      `  형식: ${pullRequest ? '🔀 :: (#이슈 번호) Subject' : 'CommitType :: Subject'}`,
      `  타입: ${COMMIT_TYPES.join(' ')}`,
      `  예시: ${pullRequest ? '🔀 :: (#12) TCP ping 기능 추가' : '📝 :: README 파일 수정'}`,
      '  규칙: COMMIT_CONVENTION.md',
    ].join('\n'),
  );
  return 1;
}

process.exitCode = main();
