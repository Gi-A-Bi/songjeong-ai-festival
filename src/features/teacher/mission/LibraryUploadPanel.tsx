import { useCallback, useId, useState, type ChangeEvent } from 'react';
import { Button } from '../../../components/Button';
import { ConfirmDialog } from '../../../components/Dialog';
import { Icon } from '../../../components/Icon';
import { InlineAlert } from '../../../components/StateViews';
import { toUserMessage } from '../../../data/errors';
import { useRepository } from '../../../data/RepositoryContext';
import {
  describeLibraryUploadQuestion,
  getLibrarySetLabel,
  parseLibraryUpload,
  type LibraryUploadResult,
} from '../../../domain/libraryUpload';
import type { LibraryCheckConfig, Mission } from '../../../domain/types';
import { useAction } from '../../../hooks/useAction';

interface LibraryUploadPanelProps {
  eventId: string;
  mission: Mission;
  /** 고치던 문제가 있으면 올리기를 막는다(올리면 설정 전체가 바뀐다). */
  disabled: boolean;
  onUploaded: (config: LibraryCheckConfig) => void;
}

interface PickedFile {
  name: string;
  result: LibraryUploadResult;
}

/** 파일을 글로 읽는다. 오래된 태블릿 브라우저도 FileReader는 지원한다. */
function readFileText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('파일을 읽지 못했어요.'));
    reader.readAsText(file);
  });
}

/**
 * 도서관 오류찾기 "문제 파일 올리기".
 * content/작성/05-도서관-오류찾기.md로 만든 JSON 파일을 골라 학년별 문제와 하나만 고르기 설정을
 * 한 번에 넣는다. 골든벨과 달리 파일의 내용으로 설정 전체를 바꾼다.
 */
export function LibraryUploadPanel({
  eventId,
  mission,
  disabled,
  onUploaded,
}: LibraryUploadPanelProps) {
  const repository = useRepository();
  const inputId = useId();
  const [picked, setPicked] = useState<PickedFile | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [uploaded, setUploaded] = useState<string | null>(null);

  const upload = useAction(
    useCallback(
      (next: LibraryCheckConfig) => repository.updateMissionConfig(eventId, mission.id, next),
      [repository, eventId, mission.id],
    ),
  );

  const onPick = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setUploaded(null);
    setReadError(null);
    upload.reset();
    try {
      const raw: unknown = JSON.parse(await readFileText(file));
      setPicked({ name: file.name, result: parseLibraryUpload(raw) });
    } catch {
      setPicked(null);
      setReadError(
        `${file.name}은(는) JSON 파일이 아니거나 읽지 못했어요. npm run library:build로 만든 파일을 골라 주세요.`,
      );
    }
  };

  const config = picked?.result.config ?? null;
  const sets = picked?.result.sets ?? [];
  const summary = sets
    .map((set) => `${getLibrarySetLabel(set.grades)} ${set.questions.length}문제`)
    .join(', ');

  const runUpload = async () => {
    if (!config) return;
    const result = await upload.run(config);
    setConfirmOpen(false);
    if (result?.ok) {
      setUploaded(`${summary}${config.pickOne ? ' · 학생이 질문 하나만 골라 풀어요' : ''}`);
      setPicked(null);
      onUploaded(config);
    }
  };

  return (
    <section className="panel stack" aria-labelledby="library-upload-title">
      <h3 id="library-upload-title" className="section-title">
        <Icon name="upload_file" /> 문제 파일 올리기
      </h3>
      <p className="muted">
        원고(<code>content/작성/05-도서관-오류찾기.md</code>)에서 <code>npm run library:build</code>
        로 만든 <code>도서관-업로드.json</code>을 고르면 학년별 문제와 “하나만 고르기” 설정을 한
        번에 넣어요. 파일의 내용으로 지금 설정 전체가 바뀌고, 올린 뒤에도 아래에서 한 문제씩 고칠 수
        있어요.
      </p>

      <div className="form-field">
        <label htmlFor={inputId} className="form-field__label">
          도서관 문제 파일(JSON) 고르기
        </label>
        <input
          id={inputId}
          type="file"
          accept=".json,application/json"
          disabled={disabled}
          onChange={(event) => void onPick(event)}
        />
        {disabled ? (
          <p className="form-field__hint">
            고치던 문제를 저장하거나 변경을 취소한 뒤에 올릴 수 있어요.
          </p>
        ) : null}
      </div>

      {readError ? <InlineAlert tone="danger">{readError}</InlineAlert> : null}
      {picked && picked.result.errors.length > 0 ? (
        <InlineAlert tone="danger">
          <p>
            <strong>{picked.name}</strong>에 고칠 곳이 있어요. 원고를 고친 뒤 다시 만들어 주세요.
          </p>
          <ul>
            {picked.result.errors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        </InlineAlert>
      ) : null}

      {config ? (
        <div className="stack">
          <ul className="question-list" aria-label="올릴 문제 미리보기">
            {sets.map((set) => {
              const label = getLibrarySetLabel(set.grades);
              return (
                <li key={label} className="question-card">
                  <h4>
                    {label} · {set.questions.length}문제
                  </h4>
                  <ol className="muted">
                    {set.questions.map((question) => (
                      <li key={question.id}>{describeLibraryUploadQuestion(question)}</li>
                    ))}
                  </ol>
                </li>
              );
            })}
          </ul>
          <p className="muted">
            {config.pickOne
              ? '학생은 질문 하나만 골라 풀어요(한 번 고르면 못 바꿈, 100점 만점).'
              : '학생은 그 학년의 문제를 모두 풀어요.'}
          </p>
          {upload.status === 'error' ? (
            <InlineAlert tone="danger">{toUserMessage(upload.error)}</InlineAlert>
          ) : null}
          <Button
            size="lg"
            icon="upload_file"
            disabled={disabled}
            onClick={() => setConfirmOpen(true)}
            loading={upload.isPending}
            loadingLabel="올리는 중"
          >
            문제 올리기 ({summary})
          </Button>
        </div>
      ) : null}

      {uploaded ? (
        <InlineAlert tone="success">
          문제를 올렸어요. {uploaded}. 학생 화면은 미션을 다시 열면 새 문제를 보여 줘요.
        </InlineAlert>
      ) : null}

      <ConfirmDialog
        open={confirmOpen}
        title="도서관 문제를 올릴까요?"
        confirmLabel="올리기"
        confirmIcon="upload_file"
        loading={upload.isPending}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => void runUpload()}
      >
        <p>
          {summary}를 새로 넣습니다. 지금 등록된 공통·학년별 문제는 모두 지워지고, 이미 제출한 팀의
          자동 점수는 새 문제 기준으로 다시 계산됩니다.
        </p>
      </ConfirmDialog>
    </section>
  );
}
