import { useCallback, useId, useState, type ChangeEvent } from 'react';
import { Button } from '../../components/Button';
import { ConfirmDialog } from '../../components/Dialog';
import { Icon } from '../../components/Icon';
import { InlineAlert } from '../../components/StateViews';
import type { FinalQuestionSetSummary } from '../../data/EventRepository';
import { toUserMessage } from '../../data/errors';
import { useRepository } from '../../data/RepositoryContext';
import { formatBytes } from '../../domain/drawingFiles';
import {
  parseFinalQuestionUpload,
  summarizeFinalQuestionSet,
  type FinalQuestionUploadResult,
} from '../../domain/finalQuestionUpload';
import type { FinalQuestionSet } from '../../domain/types';
import { useAction } from '../../hooks/useAction';
import { useAsyncData } from '../../hooks/useAsyncData';
import { formatDateTime } from '../../lib/time';

interface PickedFile {
  name: string;
  result: FinalQuestionUploadResult;
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

const SOURCE_LABELS = { sample: '샘플 문제', upload: '올린 문제' } as const;

/**
 * 총괄 설정 화면의 "최종 미션 문제 올리기".
 * content/작성 원고로 만든 JSON 파일을 골라 학년별 문제와 정답을 넣는다.
 * 정답은 이 기기에서 바로 총괄 전용 문서로 보내고 다른 교사 기기에는 내려가지 않는다.
 */
export function FinalQuestionUploadPanel({ eventId }: { eventId: string }) {
  const repository = useRepository();
  const inputId = useId();
  const load = useCallback(() => repository.listFinalQuestionSets(eventId), [repository, eventId]);
  const loaded = useAsyncData(load);
  const [picked, setPicked] = useState<PickedFile | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [uploaded, setUploaded] = useState<FinalQuestionSetSummary[] | null>(null);

  const upload = useAction(
    useCallback(
      (sets: FinalQuestionSet[]) => repository.uploadFinalQuestionSets({ eventId, sets }),
      [repository, eventId],
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
      setPicked({ name: file.name, result: parseFinalQuestionUpload(raw) });
    } catch {
      setPicked(null);
      setReadError(
        `${file.name}은(는) JSON 파일이 아니거나 읽지 못했어요. npm run final:build로 만든 파일을 골라 주세요.`,
      );
    }
  };

  const summaries = loaded.status === 'success' ? loaded.data : [];
  const blockers = new Map(summaries.map((item) => [item.grade, item.replaceBlocker]));
  const sets = picked?.result.sets ?? [];
  const ready = sets.filter((set) => !blockers.get(set.grade));
  const blocked = sets.filter((set) => blockers.get(set.grade));

  const runUpload = async () => {
    const result = await upload.run(ready);
    setConfirmOpen(false);
    if (result?.ok) {
      setUploaded(result.value);
      setPicked(null);
      loaded.reload();
    }
  };

  return (
    <section className="panel stack" aria-labelledby="admin-final-questions-title">
      <h2 id="admin-final-questions-title" className="section-title">
        <Icon name="quiz" /> 최종 미션 문제 올리기
      </h2>
      <p className="muted">
        학년별 원고(<code>content/작성/06-최종미션-N학년.md</code>)에서{' '}
        <code>npm run final:build</code>로 만든 <code>최종미션-업로드.json</code>을 고르면 문제와
        그림은 담임 선생님 기기로, 정답과 해설은 총괄만 읽는 문서로 나뉘어 저장됩니다. 이미 연
        학년이나 시작한 반이 있는 학년은 바꿀 수 없습니다.
      </p>

      {loaded.status === 'error' ? (
        <InlineAlert tone="danger">{toUserMessage(loaded.error)}</InlineAlert>
      ) : null}
      {loaded.status === 'success' ? (
        <div className="table-wrap">
          <table className="data-table">
            <caption>지금 들어 있는 문제</caption>
            <thead>
              <tr>
                <th scope="col">학년</th>
                <th scope="col" className="data-table__num">
                  문제
                </th>
                <th scope="col" className="data-table__num">
                  그림
                </th>
                <th scope="col">출처</th>
                <th scope="col">넣은 시각</th>
                <th scope="col">바꾸기</th>
              </tr>
            </thead>
            <tbody>
              {summaries.map((item) => (
                <tr
                  key={item.grade}
                  className={item.source !== 'upload' ? 'data-table__row--missing' : undefined}
                >
                  <th scope="row">{item.grade}학년</th>
                  <td className="data-table__num number">{item.questionCount}</td>
                  <td className="data-table__num number">{item.imageCount}</td>
                  <td>{item.source ? SOURCE_LABELS[item.source] : '없음'}</td>
                  <td>{formatDateTime(item.updatedAt)}</td>
                  <td>{item.replaceBlocker ?? '가능'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <div className="form-field">
        <label htmlFor={inputId} className="form-field__label">
          문제 파일(JSON) 고르기
        </label>
        <input
          id={inputId}
          type="file"
          accept=".json,application/json"
          onChange={(event) => void onPick(event)}
        />
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
              const stats = summarizeFinalQuestionSet(set);
              const blocker = blockers.get(set.grade) ?? null;
              return (
                <li key={set.grade} className="question-card">
                  <h3>
                    {set.grade}학년 · 문제 {stats.questionCount}개 · 그림 {stats.imageCount}개 ·{' '}
                    {formatBytes(stats.bytes)}
                  </h3>
                  {blocker ? <InlineAlert tone="warning">{blocker} 건너뜁니다.</InlineAlert> : null}
                  <ol className="muted">
                    {set.questions.map((config) => (
                      <li key={config.question.id}>
                        {config.question.category ? `[${config.question.category}] ` : ''}
                        {config.question.text}
                        {config.question.image ? (
                          <>
                            {' '}
                            <Icon name="image" size="sm" />
                          </>
                        ) : null}
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
            disabled={ready.length === 0}
            onClick={() => setConfirmOpen(true)}
            loading={upload.isPending}
            loadingLabel="올리는 중"
          >
            문제 올리기 ({ready.map((set) => `${set.grade}학년`).join('·') || '올릴 학년 없음'})
          </Button>
        </div>
      ) : null}

      {uploaded ? (
        <InlineAlert tone="success">
          문제를 올렸어요.{' '}
          {uploaded
            .filter((item) => item.source === 'upload')
            .map((item) => `${item.grade}학년 ${item.questionCount}문제`)
            .join(', ')}
          . 담임 선생님 화면은 새로고침하면 새 문제를 씁니다.
        </InlineAlert>
      ) : null}

      <ConfirmDialog
        open={confirmOpen}
        title="최종 미션 문제를 올릴까요?"
        confirmLabel="올리기"
        confirmIcon="upload_file"
        loading={upload.isPending}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => void runUpload()}
      >
        <p>
          {ready.map((set) => `${set.grade}학년`).join(', ')}의 문제와 정답을 새로 넣습니다. 그
          학년에 이미 있던 문제는 지워집니다.
          {blocked.length > 0
            ? ` ${blocked.map((set) => `${set.grade}학년`).join(', ')}은(는) 진행 중이라 건너뜁니다.`
            : ''}
        </p>
      </ConfirmDialog>
    </section>
  );
}
