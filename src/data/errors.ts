export type RepositoryErrorCode =
  | 'not-found'
  | 'already-claimed'
  | 'invalid-input'
  | 'not-allowed'
  | 'device-locked'
  | 'unavailable';

const DEFAULT_MESSAGES: Record<RepositoryErrorCode, string> = {
  'not-found': '정보를 찾을 수 없어요. 주소를 다시 확인해 주세요.',
  'already-claimed': '이미 받았거나 사용한 항목이에요.',
  'invalid-input': '입력한 내용을 다시 확인해 주세요.',
  'not-allowed': '지금은 할 수 없는 동작이에요.',
  'device-locked': '이 기기는 다른 팀으로 입장했어요. 선생님께 잠금 해제를 요청해 주세요.',
  unavailable: '연결이 잠시 불안정해요. 입력한 내용은 그대로 있으니 다시 시도해 주세요.',
};

/** 저장소가 던지는 오류. message는 화면에 그대로 보여 줄 수 있는 한국어 문장이다. */
export class RepositoryError extends Error {
  readonly code: RepositoryErrorCode;

  constructor(code: RepositoryErrorCode, message?: string) {
    super(message ?? DEFAULT_MESSAGES[code]);
    this.name = 'RepositoryError';
    this.code = code;
  }
}

export function isRepositoryError(
  error: unknown,
  code?: RepositoryErrorCode,
): error is RepositoryError {
  return error instanceof RepositoryError && (code === undefined || error.code === code);
}

/** 어떤 오류든 사용자에게 보여 줄 한국어 문장으로 바꾼다. */
export function toUserMessage(error: unknown): string {
  if (error instanceof RepositoryError) return error.message;
  return DEFAULT_MESSAGES.unavailable;
}
