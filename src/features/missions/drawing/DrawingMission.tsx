import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { AssetImage } from '../../../components/AssetImage';
import { Button } from '../../../components/Button';
import { Dialog } from '../../../components/Dialog';
import { Icon } from '../../../components/Icon';
import { MissionShell } from '../../../components/MissionShell';
import { StatusBadge } from '../../../components/StatusBadge';
import { RepositoryError } from '../../../data/errors';
import { formatBytes } from '../../../domain/drawingFiles';
import {
  drawingArtworkLabel,
  DRAWING_RUBRIC,
  resolveDrawingPrompt,
} from '../../../domain/drawingPrompts';
import { canSubmitInPhase } from '../../../domain/missionPhase';
import type { DrawingConfig } from '../../../domain/types';
import { getMissionLock } from '../missionLock';
import { MissionLockedPanel } from '../MissionLockedPanel';
import { MissionNotice } from '../MissionNotice';
import type { MissionScreenProps } from '../missionTypes';
import { useMissionSubmit } from '../useMissionSubmit';
import { CameraView } from './CameraView';
import {
  compressDrawing,
  isCameraSupported,
  loadPhotoFile,
  nextPhotoRotation,
  renderPhoto,
  type EncodedDrawing,
  type PhotoRotation,
} from './drawing';
import '../Missions.css';
import './Drawing.css';

interface DrawingMissionProps extends MissionScreenProps {
  config: DrawingConfig;
}

interface PreparedDrawing extends EncodedDrawing {
  url: string;
}

/**
 * 제출한 그림 미리보기. 학생은 그림 파일을 다시 읽을 수 없어(교사만 읽기)
 * 이 기기에서 방금 제출한 그림만 기억해 보여 준다.
 */
const submittedPreviews = new Map<string, string>();

/**
 * 명화를 재해석한 그림 프롬프트를 읽고 종이에 그린 뒤, 팀이 고른 그림 1장을 찍어 제출한다.
 * 채점은 선생님이 한다. 앱은 생성형 AI를 부르지 않는다.
 */
export function DrawingMission({
  eventId,
  view,
  event,
  phase,
  gate,
  onSubmitted,
  config,
}: DrawingMissionProps) {
  const { team, mission, submission, roundNo } = view;
  // 게임을 시작하기 전(또는 입장 전)에는 프롬프트를 보여 주지 않는다(먼저 본 팀이 유리해지지 않게).
  const lock = getMissionLock(view, event, phase);
  const saved =
    submission && submission.status !== 'draft' && submission.answer.type === 'drawing'
      ? submission.answer
      : null;
  const prompt = resolveDrawingPrompt(config, team.grade);
  const previewKey = `${eventId}|${team.id}|${mission.id}`;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  /** 찍거나 고른 사진 원본(돌리기 전). 돌릴 때마다 여기서 다시 만든다. */
  const [photo, setPhoto] = useState<HTMLCanvasElement | null>(null);
  const [rotation, setRotation] = useState<PhotoRotation>(0);
  const [preparing, setPreparing] = useState(false);
  const [prepared, setPrepared] = useState<PreparedDrawing | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [photoError, setPhotoError] = useState<RepositoryError | null>(null);
  const { submit, isPending, error } = useMissionSubmit(eventId, team.id, mission.id, onSubmitted);

  const editable = canSubmitInPhase(phase) && saved === null && prompt !== null && lock === null;

  // 제출하지 않고 바꾼 미리보기 주소는 메모리에서 정리한다.
  useEffect(
    () => () => {
      if (prepared && submittedPreviews.get(previewKey) !== prepared.url) {
        URL.revokeObjectURL(prepared.url);
      }
    },
    [prepared, previewKey],
  );

  const prepare = async (source: HTMLCanvasElement, turn: PhotoRotation) => {
    setPreparing(true);
    setPhotoError(null);
    const turned = turn === 0 ? source : renderPhoto(source, source.width, source.height, turn);
    const result = turned
      ? await compressDrawing(turned)
      : ({ ok: false, reason: 'unsupported', byteSize: null } as const);
    setPreparing(false);
    if (!result.ok) {
      setPrepared(null);
      setPhotoError(
        new RepositoryError(
          'invalid-input',
          result.reason === 'too-large'
            ? `사진 파일이 너무 커요(${formatBytes(result.byteSize ?? 0)}). 그림에 더 가까이 대고 다시 찍어 주세요.`
            : '이 기기에서 사진 파일을 만들지 못했어요. 선생님께 알려 주세요.',
        ),
      );
      return;
    }
    setPrepared({ ...result.drawing, url: URL.createObjectURL(result.drawing.blob) });
  };

  const acceptPhoto = (source: HTMLCanvasElement) => {
    setCameraOpen(false);
    setPhoto(source);
    setRotation(0);
    void prepare(source, 0);
  };

  const handleFile = async (change: ChangeEvent<HTMLInputElement>) => {
    const file = change.target.files?.[0];
    // 같은 파일을 다시 골라도 알 수 있게 비워 둔다.
    change.target.value = '';
    if (!file) return;
    const image = await loadPhotoFile(file);
    const source = image ? renderPhoto(image, image.naturalWidth, image.naturalHeight) : null;
    if (!source) {
      setPhotoError(
        new RepositoryError('invalid-input', '사진 파일을 열지 못했어요. 다른 사진을 골라 주세요.'),
      );
      return;
    }
    acceptPhoto(source);
  };

  const rotate = () => {
    if (!photo) return;
    const turn = nextPhotoRotation(rotation);
    setRotation(turn);
    void prepare(photo, turn);
  };

  const confirmSubmit = async () => {
    if (!prepared || !prompt) return;
    const bytes = new Uint8Array(await prepared.blob.arrayBuffer());
    const mimeType = prepared.blob.type || 'image/webp';
    // 제출이 끝나 화면이 바뀌기 전에 미리보기 주소를 남겨 둔다. 실패하면 지운다.
    submittedPreviews.set(previewKey, prepared.url);
    const ok = await submit(
      {
        type: 'drawing',
        promptId: prompt.id,
        mimeType,
        byteSize: bytes.length,
        width: prepared.width,
        height: prepared.height,
      },
      {
        promptId: prompt.id,
        mimeType,
        width: prepared.width,
        height: prepared.height,
        bytes,
      },
    );
    if (!ok) submittedPreviews.delete(previewKey);
    setConfirmOpen(false);
  };

  const submittedPreview = submittedPreviews.get(previewKey);
  const cameraSupported = isCameraSupported();

  return (
    <MissionShell
      mission={mission}
      team={team}
      roundNo={roundNo}
      event={event}
      phase={phase}
      notice={<MissionNotice phase={phase} event={event} view={view} error={error ?? photoError} />}
      gate={gate}
      actions={
        saved ? (
          <StatusBadge tone="info" icon="lock" size="lg">
            제출 완료 · 선생님이 순위를 정해요
          </StatusBadge>
        ) : (
          <>
            <p className="mission-actions__hint">
              <Icon name="info" />
              사진에 이름과 얼굴이 나오지 않게 해요
            </p>
            <Button
              size="xl"
              icon="send"
              onClick={() => setConfirmOpen(true)}
              disabled={!editable || prepared === null || cameraOpen}
              loading={preparing}
              loadingLabel="사진 준비 중"
            >
              이 사진으로 제출
            </Button>
          </>
        )
      }
    >
      {lock !== null ? (
        // 프롬프트 글은 화면에 올리지 않는다(숨기기만 하면 화면 검사로 볼 수 있다).
        <MissionLockedPanel mission={mission} reason={lock} subject="그림 프롬프트가">
          <p>명화를 AI 시대의 모습으로 다시 그리는 프롬프트를 읽고 종이에 그려요.</p>
          <p>팀에서 1장을 골라 사진으로 제출해요. 이름과 얼굴이 나오지 않게 찍어요.</p>
        </MissionLockedPanel>
      ) : (
        <div className="drawing-layout">
          <section className="drawing-prompt" aria-labelledby="drawing-prompt-title">
            <h2 id="drawing-prompt-title" className="drawing-prompt__label">
              <Icon name="smart_toy" />
              그림 프롬프트
            </h2>
            {prompt ? (
              <>
                <p className="drawing-prompt__artwork">
                  <Icon name="museum" />
                  {drawingArtworkLabel(prompt)}
                </p>
                <p className="drawing-prompt__text">{prompt.text}</p>
                <ul className="drawing-rubric" aria-label="AI 심사위원이 보는 것">
                  {DRAWING_RUBRIC.map((item) => (
                    <li key={item.id} className="drawing-rubric__item">
                      {item.name} <span className="number">{item.max}점</span>
                    </li>
                  ))}
                </ul>
                <p className="drawing-prompt__tip">
                  그림 실력이 아니라 프롬프트의 조건을 얼마나 정확하게 지켰는지 봐요.
                </p>
              </>
            ) : (
              <p className="drawing-prompt__text">
                그림 프롬프트가 아직 없어요. 선생님께 알려 주세요.
              </p>
            )}
          </section>

          {saved ? (
            <figure className="drawing-submitted">
              {submittedPreview ? (
                <img
                  src={submittedPreview}
                  alt="우리 팀이 제출한 그림 사진"
                  className="drawing-submitted__image"
                />
              ) : (
                <AssetImage asset="mascotCorrect" decorative className="waiting-panel__mascot" />
              )}
              <figcaption>그림 사진을 선생님께 보냈어요 ({formatBytes(saved.byteSize)})</figcaption>
            </figure>
          ) : cameraOpen ? (
            <CameraView
              onShot={acceptPhoto}
              onPickFile={() => {
                setCameraOpen(false);
                fileInputRef.current?.click();
              }}
              onClose={() => setCameraOpen(false)}
            />
          ) : (
            <section className="photo-panel" aria-labelledby="photo-panel-title">
              <h2 id="photo-panel-title" className="visually-hidden">
                그림 사진
              </h2>
              {prepared ? (
                <img src={prepared.url} alt="제출할 그림 사진" className="photo-panel__image" />
              ) : (
                <ol className="photo-steps">
                  <li className="photo-steps__item">
                    <span className="photo-steps__no number">1</span>
                    <span>
                      <strong>종이에 그려요</strong>
                      프롬프트의 조건을 하나도 빠뜨리지 않게 그려요.
                    </span>
                  </li>
                  <li className="photo-steps__item">
                    <span className="photo-steps__no number">2</span>
                    <span>
                      <strong>팀에서 1장을 골라요</strong>
                      조건을 가장 잘 지킨 그림을 함께 골라요.
                    </span>
                  </li>
                  <li className="photo-steps__item">
                    <span className="photo-steps__no number">3</span>
                    <span>
                      <strong>사진을 찍어 제출해요</strong>
                      그림만 크게, 이름과 얼굴은 나오지 않게 찍어요.
                    </span>
                  </li>
                </ol>
              )}
              <div className="photo-panel__actions">
                {cameraSupported ? (
                  <Button
                    size="lg"
                    variant={prepared ? 'secondary' : 'primary'}
                    icon="photo_camera"
                    onClick={() => setCameraOpen(true)}
                    disabled={!editable || preparing}
                  >
                    {prepared ? '다시 찍기' : '사진 찍기'}
                  </Button>
                ) : null}
                <Button
                  size="lg"
                  variant="secondary"
                  icon="image"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={!editable || preparing}
                >
                  사진 파일 고르기
                </Button>
                {prepared ? (
                  <Button
                    size="lg"
                    variant="secondary"
                    icon="rotate_right"
                    onClick={rotate}
                    disabled={!editable || preparing}
                  >
                    돌리기
                  </Button>
                ) : null}
              </div>
            </section>
          )}
          {/* 카메라 화면에서도 누를 수 있게 늘 그려 둔다. 찍어 둔 사진 파일도 고를 수 있게 capture는 쓰지 않는다. */}
          {saved ? null : (
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="visually-hidden"
              aria-label="그림 사진 파일"
              tabIndex={-1}
              disabled={!editable}
              onChange={(change) => void handleFile(change)}
            />
          )}
        </div>
      )}

      <Dialog
        open={confirmOpen && prepared !== null}
        title="이 사진으로 제출할까요?"
        size="lg"
        onClose={() => {
          if (!isPending) setConfirmOpen(false);
        }}
        footer={
          <>
            <Button
              variant="secondary"
              size="lg"
              icon="photo_camera"
              onClick={() => setConfirmOpen(false)}
              disabled={isPending}
            >
              다시 확인하기
            </Button>
            <Button
              size="lg"
              icon="send"
              onClick={() => void confirmSubmit()}
              loading={isPending}
              loadingLabel="보내는 중"
            >
              제출하기
            </Button>
          </>
        }
      >
        {prepared ? (
          <img src={prepared.url} alt="제출할 그림 사진 미리보기" className="drawing-preview" />
        ) : null}
        <ul className="photo-checks">
          <li>
            <Icon name="check_circle" /> 그림이 또렷하고 위아래가 바르게 보이나요?
          </li>
          <li>
            <Icon name="check_circle" /> 이름과 얼굴이 나오지 않았나요?
          </li>
        </ul>
        <p className="muted">
          사진 파일({prepared ? formatBytes(prepared.blob.size) : '-'})이 선생님 화면으로 가요. 한
          번 제출하면 선생님이 허락할 때만 다시 낼 수 있어요.
        </p>
      </Dialog>
    </MissionShell>
  );
}
