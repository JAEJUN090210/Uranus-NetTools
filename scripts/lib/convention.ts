export const COMMIT_TYPES = ['📑', '⚡️', '⚰️', '🐛', '♻️', '📝', '⚙️', '🧪', '🚀', '🔀'] as const;

export const MAX_SUBJECT_LENGTH = 50;

const MERGE_TYPE = '🔀';
const RELEASE_TYPE = '🚀';
const HEADER_PATTERN = /^(\S+) :: (?:\(#(\d+)\))?(.*)$/u;
const AUTOSQUASH_PATTERN = /^(?:fixup|squash|amend)! /;
const HANGUL_PATTERN = /\p{Script=Hangul}/u;
const PAST_TENSE_PATTERN = /(?:했다|하였다|했습니다|했음)$/u;
const SCISSORS_LINE = '# ------------------------ >8 ------------------------';

// 이모지 뒤의 변형 선택자(U+FE0F)는 입력기마다 붙기도 하고 빠지기도 해서 비교할 때 무시합니다.
function normalizeType(type: string): string {
  return type.replaceAll('️', '');
}

const KNOWN_TYPES = new Set<string>(COMMIT_TYPES.map(normalizeType));

export interface ValidateOptions {
  pullRequest?: boolean;
}

// git이 commit-msg 훅에 넘기는 파일에는 주석과 diff(scissors 아래)가 남아 있으므로 첫 내용 줄만 꺼냅니다.
export function extractHeader(message: string): string {
  for (const line of message.split(/\r?\n/)) {
    if (line === SCISSORS_LINE) {
      break;
    }
    if (line.startsWith('#') || line.trim() === '') {
      continue;
    }
    return line.trimEnd();
  }
  return '';
}

export function validateHeader(
  header: string,
  { pullRequest = false }: ValidateOptions = {},
): string[] {
  // fixup!/squash!/amend! 커밋은 rebase 때 다른 커밋에 합쳐지므로 검사하지 않습니다.
  if (!pullRequest && AUTOSQUASH_PATTERN.test(header)) {
    return [];
  }

  const match = HEADER_PATTERN.exec(header);
  if (!match) {
    return ['`CommitType :: Subject` 형식이 아닙니다.'];
  }

  const [, rawType = '', issue, rest = ''] = match;
  const type = normalizeType(rawType);
  const subject = rest.trim();
  const errors: string[] = [];

  if (!KNOWN_TYPES.has(type)) {
    errors.push(`알 수 없는 커밋 타입입니다: ${rawType}`);
  }
  if (pullRequest && type !== MERGE_TYPE) {
    errors.push(`PR 제목은 \`${MERGE_TYPE} ::\`으로 시작합니다.`);
  }
  if (pullRequest && issue === undefined) {
    errors.push('PR 제목에는 `:: ` 바로 뒤에 `(#이슈 번호)`가 필요합니다.');
  }

  if (subject === '') {
    errors.push('Subject가 비어 있습니다.');
    return errors;
  }

  // 결합 이모지나 조합형 한글도 한 글자로 세도록 문자소(grapheme) 단위로 셉니다.
  const length = Array.from(
    new Intl.Segmenter('ko', { granularity: 'grapheme' }).segment(subject),
  ).length;
  if (length > MAX_SUBJECT_LENGTH) {
    errors.push(`Subject가 ${MAX_SUBJECT_LENGTH}자를 넘습니다. (현재 ${length}자)`);
  }
  if (type !== RELEASE_TYPE && !HANGUL_PATTERN.test(subject)) {
    errors.push('Subject는 한국어로 작성합니다.');
  }
  if (PAST_TENSE_PATTERN.test(subject)) {
    errors.push("Subject는 '~수정 했다'가 아니라 '~수정'처럼 명령형으로 끝냅니다.");
  }
  return errors;
}
