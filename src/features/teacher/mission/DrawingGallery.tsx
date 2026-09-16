import { useCallback, useMemo, useRef, useState } from 'react';
import { buttonClassName } from '../../../components/buttonStyles';
import { Button } from '../../../components/Button';
import { Icon } from '../../../components/Icon';
import { InlineAlert } from '../../../components/StateViews';
import { StatusBadge } from '../../../components/StatusBadge';
import type { MissionParticipant } from '../../../data/EventRepository';
import { toUserMessage } from '../../../data/errors';
import { useRepository } from '../../../data/RepositoryContext';
import {
  buildDrawingEvaluationPrompt,
  drawingFileName,
  drawingZipName,
  formatBytes,
} from '../../../domain/drawingFiles';
import type { DrawingConfig, DrawingFile, Grade, Mission, RoundNo } from '../../../domain/types';
import { useAction } from '../../../hooks/useAction';
import { bytesToDataUrl, copyText, downloadBytes } from '../../../lib/download';
import { formatTimeOfDay } from '../../../lib/time';
import { createZip } from '../../../lib/zip';

interface DrawingGalleryProps {
  eventId: string;
  mission: Mission;
  config: DrawingConfig;
  grade: Grade;
  round: RoundNo;
  participants: MissionParticipant[];
}

/**
 * 제출 그림 모아보기·내려받기와 AI 평가 요청문.
 * 그림 파일은 용량이 커서 선생님이 누를 때만 읽는다.
 */
export function DrawingGallery({
  eventId,
  mission,
  config,
  grade,
  round,
  participants,
}: DrawingGalleryProps) {
  const repository = useRepository();
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const [files, setFiles] = useState<DrawingFile[] | null>(null);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');

  const load = useAction(
    useCallback(
      () => repository.listDrawingFiles(eventId, mission.id, grade, round),
      [repository, eventId, mission.id, grade, round],
    ),
  );

  // 그림 미리보기 주소 만들기는 무거워서 참가 팀이나 불러온 파일이 바뀔 때만 다시 만든다.
  const cards = useMemo(
    () =>
      participants
        .filter(
          (participant) =>
            participant.submission !== null &&
            participant.submission.status !== 'draft' &&
            participant.submission.answer.type === 'drawing',
        )
        .map((participant) => {
          const file = files?.find((item) => item.teamId === participant.team.id) ?? null;
          const answer = participant.submission?.answer;
          const mimeType =
            file?.mimeType ?? (answer?.type === 'drawing' ? answer.mimeType : 'image/webp');
          return {
            participant,
            file,
            fileName: drawingFileName(participant.team, round, mimeType),
            src: file && file.bytes.length > 0 ? bytesToDataUrl(file.bytes, file.mimeType) : null,
          };
        }),
    [participants, files, round],
  );

  const prompt = buildDrawingEvaluationPrompt({
    description: config.prompt,
    fileNames: cards.map((card) => card.fileName),
  });
  const downloadable = cards.filter((card) => card.file && card.file.bytes.length > 0);

  const handleLoad = async () => {
    const result = await load.run();
    if (result?.ok) setFiles(result.value);
  };

  const handleZip = () => {
    const zip = createZip(
      downloadable.map((card) => ({
        name: card.fileName,
        data: card.file?.bytes ?? new Uint8Array(),
        modifiedAt: card.file?.submittedAt ? new Date(card.file.submittedAt) : undefined,
      })),
    );
    downloadBytes(zip, drawingZipName(mission.title, grade, round), 'application/zip');
  };

  const handleCopy = async () => {
    const ok = await copyText(prompt, promptRef.current);
    setCopyState(ok ? 'copied' : 'failed');
  };

  return (
    <section className="panel stack" aria-labelledby="drawing-gallery-title">
      <div className="teacher-title">
        <h2 id="drawing-gallery-title" className="section-title">
          <Icon name="brush" /> 제출 그림
          <StatusBadge tone="info" icon="groups">
            제출 {cards.length}/{participants.length}
          </StatusBadge>
        </h2>
        <div className="cluster">
          <Button
            variant="secondary"
            icon="refresh"
            loading={load.isPending}
            loadingLabel="불러오는 중"
            disabled={cards.length === 0}
            onClick={() => void handleLoad()}
          >
            {files ? '그림 다시 불러오기' : '그림 불러오기'}
          </Button>
          <Button icon="folder_zip" disabled={downloadable.length === 0} onClick={handleZip}>
            모두 내려받기 (ZIP {downloadable.length}개)
          </Button>
        </div>
      </div>

      {load.status === 'error' ? (
        <InlineAlert tone="danger">{toUserMessage(load.error)}</InlineAlert>
      ) : null}
      {cards.length === 0 ? (
        <p className="muted">아직 그림을 제출한 팀이 없어요.</p>
      ) : files === null ? (
        <p className="muted">
          그림 파일은 용량이 커서 “그림 불러오기”를 누를 때만 읽어요. 새로 제출한 팀이 있으면 다시
          불러와 주세요.
        </p>
      ) : (
        <ul className="drawing-gallery">
          {cards.map(({ participant, file, fileName, src }) => (
            <li key={participant.team.id} className="drawing-card">
              {src ? (
                <img
                  src={src}
                  alt={`${participant.team.displayName} 그림`}
                  className="drawing-card__image"
                />
              ) : (
                <div className="drawing-card__empty">
                  <Icon name="warning" />
                  그림 파일이 없어요
                </div>
              )}
              <div className="drawing-card__body">
                <strong>{participant.team.displayName}</strong>
                <span className="muted number">
                  {formatTimeOfDay(
                    file?.submittedAt ?? participant.submission?.submittedAt ?? null,
                  )}
                  {file ? ` · ${formatBytes(file.byteSize)}` : ''}
                </span>
                {src ? (
                  <a
                    className={buttonClassName({ variant: 'secondary', size: 'md' })}
                    href={src}
                    download={fileName}
                  >
                    <Icon name="download" />
                    <span className="btn__label">내려받기</span>
                  </a>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="prompt-box">
        <h3 className="section-title">
          <Icon name="smart_toy" /> AI 평가 요청문
        </h3>
        <ol className="prompt-box__steps">
          <li>“모두 내려받기”로 ZIP 파일을 받아 압축을 풀어요.</li>
          <li>아래 요청문을 복사해 사용하는 생성형 AI에 붙여 넣고, 그림 파일을 모두 첨부해요.</li>
          <li>AI 결과는 참고만 하고, 점수와 순위는 아래 표에서 선생님이 정해요.</li>
        </ol>
        <textarea
          ref={promptRef}
          className="text-input prompt-box__text"
          aria-label="AI 평가 요청문"
          readOnly
          rows={12}
          value={prompt}
        />
        <div className="cluster">
          <Button
            icon="content_copy"
            onClick={() => void handleCopy()}
            disabled={cards.length === 0}
          >
            요청문 복사
          </Button>
          {copyState === 'copied' ? (
            <StatusBadge tone="success" icon="check_circle">
              복사했어요
            </StatusBadge>
          ) : null}
          {copyState === 'failed' ? (
            <StatusBadge tone="warning" icon="warning">
              복사하지 못했어요. 글을 직접 선택해 복사해 주세요.
            </StatusBadge>
          ) : null}
        </div>
      </div>
    </section>
  );
}
