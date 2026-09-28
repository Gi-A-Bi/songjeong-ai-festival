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
import {
  drawingArtworkLabel,
  drawingOptionMark,
  DRAWING_MAX_SCORE,
  DRAWING_RUBRIC,
  resolveDrawingPrompt,
} from '../../../domain/drawingPrompts';
import type { DrawingConfig, DrawingFile, Grade, Mission, RoundNo } from '../../../domain/types';
import { useAction } from '../../../hooks/useAction';
import { bytesToDataUrl, copyText, downloadBytes } from '../../../lib/download';
import { labelPhoto, type LabeledPhoto } from '../../../lib/photoLabel';
import { formatTimeOfDay } from '../../../lib/time';
import { createZip } from '../../../lib/zip';
import { ArtworkDialog } from './ArtworkDialog';

interface DrawingGalleryProps {
  eventId: string;
  mission: Mission;
  config: DrawingConfig;
  grade: Grade;
  round: RoundNo;
  /** 한 라운드의 활동 시간(분). 운영 순서 안내에 쓴다. */
  roundMinutes: number;
  participants: MissionParticipant[];
}

/**
 * 이번 학년의 명화 프롬프트, 제출한 그림 사진 모아보기·내려받기, AI 심사 요청문.
 * 사진 파일은 용량이 커서 선생님이 누를 때만 읽는다.
 * 내려받는 사진에는 팀 이름표를 붙여, 생성형 AI가 팀별 점수표를 만들 때 어느 팀 그림인지 알 수 있게 한다.
 */
export function DrawingGallery({
  eventId,
  mission,
  config,
  grade,
  round,
  roundMinutes,
  participants,
}: DrawingGalleryProps) {
  const repository = useRepository();
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const drawingPrompt = resolveDrawingPrompt(config, grade);
  const [artworkOpen, setArtworkOpen] = useState(false);
  const [files, setFiles] = useState<DrawingFile[] | null>(null);
  /** 팀 이름표를 붙인 사진(팀 ID별). 만들지 못한 팀은 원래 사진을 쓴다. */
  const [labeled, setLabeled] = useState<Record<string, LabeledPhoto>>({});
  /** 마지막으로 복사를 시도한 요청문. 요청문이 바뀌면 “복사했어요”를 더 보여 주지 않는다. */
  const [copyResult, setCopyResult] = useState<{ text: string; ok: boolean } | null>(null);

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
          const original =
            file && file.bytes.length > 0 ? { bytes: file.bytes, mimeType: file.mimeType } : null;
          const label = original ? (labeled[participant.team.id] ?? null) : null;
          const photo = label ?? original;
          const mimeType =
            photo?.mimeType ?? (answer?.type === 'drawing' ? answer.mimeType : 'image/webp');
          return {
            participant,
            file,
            photo,
            hasLabel: label !== null,
            fileName: drawingFileName(participant.team, round, mimeType),
            src: photo ? bytesToDataUrl(photo.bytes, photo.mimeType) : null,
          };
        }),
    [participants, files, labeled, round],
  );

  const downloadable = cards.filter((card) => card.photo !== null);
  /** 이름표를 붙이지 못한 사진이 하나라도 있으면 첨부 순서와 파일 이름으로 팀을 알아보게 한다. */
  const allLabeled = downloadable.every((card) => card.hasLabel);
  // 사진을 불러온 뒤에는 실제로 내려받는 사진만 요청문에 적어, 첨부하는 장수와 요청문이 어긋나지 않게 한다.
  const judged = files === null ? cards : downloadable;
  const prompt = buildDrawingEvaluationPrompt({
    description: drawingPrompt?.text ?? '',
    teams: judged.map((card) => ({
      name: card.participant.team.displayName,
      fileName: card.fileName,
    })),
    labeled: allLabeled,
  });

  const handleLoad = async () => {
    const result = await load.run();
    if (!result?.ok) return;
    const loaded = result.value;
    const entries = await Promise.all(
      loaded.map(async (file) => {
        const team = participants.find((item) => item.team.id === file.teamId)?.team;
        if (!team || file.bytes.length === 0) return null;
        const photo = await labelPhoto(file.bytes, file.mimeType, team.displayName);
        return photo ? ([file.teamId, photo] as const) : null;
      }),
    );
    setLabeled(Object.fromEntries(entries.filter((entry) => entry !== null)));
    setFiles(loaded);
  };

  const handleZip = () => {
    const zip = createZip(
      downloadable.map((card) => ({
        name: card.fileName,
        data: card.photo?.bytes ?? new Uint8Array(),
        modifiedAt: card.file?.submittedAt ? new Date(card.file.submittedAt) : undefined,
      })),
    );
    downloadBytes(zip, drawingZipName(mission.title, grade, round), 'application/zip');
  };

  const handleCopy = async () => {
    const ok = await copyText(prompt, promptRef.current);
    setCopyResult({ text: prompt, ok });
  };
  const copyState = copyResult?.text === prompt ? (copyResult.ok ? 'copied' : 'failed') : 'idle';

  return (
    <section className="panel stack" aria-labelledby="drawing-gallery-title">
      <div className="prompt-now">
        <div className="teacher-title">
          <h2 className="section-title">
            <Icon name="museum" /> {grade}학년 그림 프롬프트
          </h2>
          <Button
            variant="accent"
            icon="fullscreen"
            disabled={drawingPrompt === null}
            onClick={() => setArtworkOpen(true)}
          >
            명화 크게 보기
          </Button>
        </div>
        {drawingPrompt ? (
          <>
            <p className="prompt-now__artwork">
              {drawingOptionMark(drawingPrompt)} {drawingArtworkLabel(drawingPrompt)}
            </p>
            <p className="prompt-now__text">{drawingPrompt.text}</p>
          </>
        ) : (
          <InlineAlert tone="warning">
            이 학년이 그릴 그림 프롬프트가 없어요. “프롬프트 고르기”에서 확인해 주세요.
          </InlineAlert>
        )}
        <ol className="prompt-box__steps">
          <li>“명화 크게 보기”를 전자칠판에 띄워 1분 동안 함께 감상하고 표현 기법을 확인해요.</li>
          <li>
            학생은 프롬프트의 조건을 지켜 종이에 그려요. 게임 시간은 {roundMinutes}분이에요. 끝나기
            2분 전에는 사진을 찍도록 알려 주세요.
          </li>
          <li>팀에서 고른 그림 1장을 팀 기기로 찍어 제출해요. 이름과 얼굴이 나오면 안 돼요.</li>
        </ol>
      </div>

      <div className="teacher-title">
        <h2 id="drawing-gallery-title" className="section-title">
          <Icon name="brush" /> 제출한 그림 사진
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
        <p className="muted">아직 그림 사진을 제출한 팀이 없어요.</p>
      ) : files === null ? (
        <p className="muted">
          사진 파일은 용량이 커서 “그림 불러오기”를 누를 때만 읽어요. 새로 제출한 팀이 있으면 다시
          불러와 주세요.
        </p>
      ) : (
        <ul className="drawing-gallery">
          {cards.map(({ participant, file, photo, fileName, src }) => (
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
                  {photo ? ` · ${formatBytes(photo.bytes.length)}` : ''}
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
          <Icon name="smart_toy" /> AI 심사 요청문
        </h3>
        <ol className="prompt-box__steps">
          <li>
            “그림 불러오기”를 누른 뒤 “모두 내려받기”로 ZIP 파일을 받아 압축을 풀어요. 사진 아래에는
            팀 이름표가 붙어 있어요.
          </li>
          <li>
            “요청문 복사”를 누르고 선생님이 쓰는 생성형 AI 채팅창에 붙여 넣은 뒤, 사진을 모두 첨부해
            보내요. 생성형 AI는 선생님만 조작해요.
          </li>
          <li>
            AI 답변 맨 위에 <strong>팀별 점수표</strong>가 나와요. 표를 보고 아래 채점표에서 팀마다
            영역별 점수를 골라 주세요.
          </li>
          <li>
            AI가 센 개수나 위치가 실제 그림과 같은지 학생들과 확인해요. AI의 판단도 틀릴 수 있어요.
          </li>
          <li>
            AI 결과는 참고만 하고, 점수({DRAWING_MAX_SCORE}점 만점)와 순위는 아래 표에서 선생님이
            정해요.
          </li>
        </ol>
        {files !== null && !allLabeled ? (
          <InlineAlert tone="warning">
            이 기기에서는 사진에 팀 이름표를 붙이지 못했어요. 요청문에 적힌 순서대로 사진을 첨부해
            주세요.
          </InlineAlert>
        ) : null}
        <ul className="rubric-list" aria-label="AI 심사 기준">
          {DRAWING_RUBRIC.map((item) => (
            <li key={item.id}>
              <strong>
                {item.name} {item.max}점
              </strong>{' '}
              {item.description}
            </li>
          ))}
        </ul>
        <textarea
          ref={promptRef}
          className="text-input prompt-box__text"
          aria-label="AI 심사 요청문"
          readOnly
          rows={14}
          value={prompt}
        />
        {/* 제출한 그림이 없어도 복사할 수 있다. 버튼을 끌 때는 이유를 함께 알려 준다. */}
        {drawingPrompt === null ? (
          <p className="muted">
            <Icon name="info" size="sm" /> 이 학년의 그림 프롬프트가 없어 요청문을 만들 수 없어요.
            “프롬프트 고르기”에서 먼저 골라 주세요.
          </p>
        ) : judged.length === 0 ? (
          <p className="muted">
            <Icon name="info" size="sm" /> 아직 제출한 그림 사진이 없어 팀 이름 없이 심사 기준만
            담은 요청문이에요. 팀이 그림을 제출하면 팀 이름과 점수표가 함께 들어가요.
          </p>
        ) : null}
        <div className="cluster">
          <Button
            icon="content_copy"
            onClick={() => void handleCopy()}
            disabled={drawingPrompt === null}
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

      <ArtworkDialog
        prompt={artworkOpen ? drawingPrompt : null}
        onClose={() => setArtworkOpen(false)}
      />
    </section>
  );
}
