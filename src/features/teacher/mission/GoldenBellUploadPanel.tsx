import { useCallback, useId, useState, type ChangeEvent } from 'react';
import { Button } from '../../../components/Button';
import { ConfirmDialog } from '../../../components/Dialog';
import { Icon } from '../../../components/Icon';
import { InlineAlert } from '../../../components/StateViews';
import { toUserMessage } from '../../../data/errors';
import { useRepository } from '../../../data/RepositoryContext';
import {
  countGoldenBellKinds,
  getGoldenBellKind,
  GOLDEN_BELL_KIND_LABELS,
} from '../../../domain/goldenBell';
import {
  applyGoldenBellUpload,
  getGoldenBellSetLabel,
  parseGoldenBellUpload,
  type GoldenBellUploadResult,
} from '../../../domain/goldenBellUpload';
import type { GoldenBellConfig, Mission } from '../../../domain/types';
import { useAction } from '../../../hooks/useAction';

interface GoldenBellUploadPanelProps {
  eventId: string;
  mission: Mission;
  config: GoldenBellConfig;
  /** 고치던 문제가 있으면 올리기를 막는다(올리면 목록이 바뀐다). */
  disabled: boolean;
  onUploaded: () => void;
}

interface PickedFile {
  name: string;
  result: GoldenBellUploadResult;
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
 * 골든벨 "문제 파일 올리기".
 * content/작성/01-골든벨.md로 만든 JSON 파일을 골라 학년별 문제를 한 번에 넣는다.
 * 파일에 있는 학년만 바꾸고 나머지 학년의 문제는 그대로 둔다.
 */
export function GoldenBellUploadPanel({
  eventId,
  mission,
  config,
  disabled,
  onUploaded,
}: GoldenBellUploadPanelProps) {
  const repository = useRepository();
  const inputId = useId();
  const [picked, setPicked] = useState<PickedFile | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [uploaded, setUploaded] = useState<string | null>(null);

  const upload = useAction(
    useCallback(
      (next: GoldenBellConfig) => repository.updateMissionConfig(eventId, mission.id, next),
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
      setPicked({ name: file.name, result: parseGoldenBellUpload(raw) });
    } catch {
      setPicked(null);
      setReadError(
        `${file.name}은(는) JSON 파일이 아니거나 읽지 못했어요. npm run golden:build로 만든 파일을 골라 주세요.`,
      );
    }
  };

  const sets = picked?.result.sets ?? [];
  const labels = sets.map((set) => getGoldenBellSetLabel(set.grades));

  const runUpload = async () => {
    const result = await upload.run(applyGoldenBellUpload(config, sets));
    setConfirmOpen(false);
    if (result?.ok) {
      setUploaded(
        sets
          .map((set) => `${getGoldenBellSetLabel(set.grades)} ${set.questions.length}문항`)
          .join(', '),
      );
      setPicked(null);
      onUploaded();
    }
  };

  return (
    <section className="panel stack" aria-labelledby="gb-upload-title">
      <h3 id="gb-upload-title" className="section-title">
        <Icon name="upload_file" /> 문제 파일 올리기
      </h3>
      <p className="muted">
        원고(<code>content/작성/01-골든벨.md</code>)에서 <code>npm run golden:build</code>로 만든{' '}
        <code>골든벨-업로드.json</code>을 고르면 학년별 문제를 한 번에 넣어요. 파일에 있는 학년의
        문제만 바뀌고, 올린 뒤에도 위에서 한 문제씩 고칠 수 있어요.
      </p>

      <div className="form-field">
        <label htmlFor={inputId} className="form-field__label">
          골든벨 문제 파일(JSON) 고르기
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

      {picked && picked.result.errors.length === 0 ? (
        <div className="stack">
          <ul className="question-list" aria-label="올릴 문제 미리보기">
            {sets.map((set) => {
              const counts = countGoldenBellKinds(set.questions);
              const label = getGoldenBellSetLabel(set.grades);
              return (
                <li key={label} className="question-card">
                  <h4>
                    {label} · {counts.total}문항 (O/X {counts.ox}, 객관식 {counts.choice}, 단답형{' '}
                    {counts.short})
                  </h4>
                  <ol className="muted">
                    {set.questions.map((question) => (
                      <li key={question.id}>
                        [{GOLDEN_BELL_KIND_LABELS[getGoldenBellKind(question)]}] {question.question}
                      </li>
                    ))}
                  </ol>
                </li>
              );
            })}
          </ul>
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
            문제 올리기 ({labels.join(', ')})
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
        title="골든벨 문제를 올릴까요?"
        confirmLabel="올리기"
        confirmIcon="upload_file"
        loading={upload.isPending}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => void runUpload()}
      >
        <p>
          {labels.join(', ')}의 문제를 새로 넣습니다. 그 학년에 이미 있던 문제는 지워지고, 이미
          제출한 팀의 자동 점수는 새 문제 기준으로 다시 계산됩니다.
        </p>
      </ConfirmDialog>
    </section>
  );
}
