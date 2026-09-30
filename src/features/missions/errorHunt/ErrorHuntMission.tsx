import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { useSettings } from '../../../app/SettingsContext';
import { getAsset } from '../../../assets/manifest';
import { AssetImage } from '../../../components/AssetImage';
import { Button } from '../../../components/Button';
import { Icon } from '../../../components/Icon';
import { MissionShell } from '../../../components/MissionShell';
import { StatusBadge } from '../../../components/StatusBadge';
import { useRepository } from '../../../data/RepositoryContext';
import {
  countFoundInPuzzle,
  getErrorHuntPuzzles,
  getFirstOpenPuzzleIndex,
  isErrorHuntPictureHidden,
} from '../../../domain/errorHunt';
import { canSubmitInPhase, getWaitingReason } from '../../../domain/missionPhase';
import { findHitRegion } from '../../../domain/scoring';
import type { ErrorHuntConfig } from '../../../domain/types';
import { MissionNotice } from '../MissionNotice';
import type { MissionScreenProps } from '../missionTypes';
import { useMissionSubmit } from '../useMissionSubmit';
import '../Missions.css';
import './ErrorHunt.css';
import { HuntRegionMarker } from './HuntRegionMarker';

interface ErrorHuntMissionProps extends MissionScreenProps {
  config: ErrorHuntConfig;
}

interface MissMarker {
  id: number;
  x: number;
  y: number;
}

/**
 * 그 학년의 그림을 차례로 보며 이상한 곳을 눌러 찾는다.
 * 그림은 자유롭게 넘겨 볼 수 있고, 찾은 곳은 모든 그림을 합쳐 한 번에 제출한다.
 * 게임을 시작하기 전에는 그림을 화면에 올리지 않고 가림막을 보여 준다.
 */
export function ErrorHuntMission({
  eventId,
  view,
  event,
  phase,
  onSubmitted,
  config,
}: ErrorHuntMissionProps) {
  const { team, mission, submission, roundNo } = view;
  const { playEffect } = useSettings();
  const puzzles = getErrorHuntPuzzles(config, team.grade);
  const saved =
    submission && submission.status !== 'draft' && submission.answer.type === 'error_hunt'
      ? submission.answer
      : null;
  const [found, setFound] = useState<string[]>(saved?.foundRegionIds ?? []);
  const [wrongTaps, setWrongTaps] = useState(saved?.wrongTaps ?? 0);
  const [index, setIndex] = useState(() => getFirstOpenPuzzleIndex(puzzles, found));
  const [misses, setMisses] = useState<MissMarker[]>([]);
  const [feedback, setFeedback] = useState('');
  const missSeq = useRef(0);
  const repository = useRepository();
  const { submit, isPending, error } = useMissionSubmit(eventId, team.id, mission.id, onSubmitted);

  // 다음 그림으로 넘길 때 바로 보이도록 그림을 미리 받아 둔다.
  const imageSources = puzzles.map((puzzle) => getAsset(puzzle.imageKey).src).join('|');
  useEffect(() => {
    for (const src of imageSources.split('|')) {
      const image = new Image();
      image.src = src;
    }
  }, [imageSources]);

  const editable = canSubmitInPhase(phase) && saved === null && !isPending;
  const hidden = isErrorHuntPictureHidden(
    phase,
    getWaitingReason({
      event,
      grade: team.grade,
      missionRound: roundNo,
      roundStatus: view.roundStatus,
    }),
  );
  const total = puzzles.reduce((sum, puzzle) => sum + puzzle.regions.length, 0);
  const foundCount = puzzles.reduce((sum, puzzle) => sum + countFoundInPuzzle(puzzle, found), 0);
  const currentIndex = Math.min(index, puzzles.length - 1);
  const current = puzzles[currentIndex];
  const currentFound = countFoundInPuzzle(current, found);
  const currentDone = currentFound === current.regions.length;
  const isLast = currentIndex === puzzles.length - 1;
  const many = puzzles.length > 1;

  const goTo = (next: number) => {
    setIndex(next);
    setMisses([]);
    setFeedback('');
  };

  const handleTap = (tap: MouseEvent<HTMLDivElement>) => {
    if (!editable) return;
    const rect = tap.currentTarget.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const point = {
      x: (tap.clientX - rect.left) / rect.width,
      y: (tap.clientY - rect.top) / rect.height,
    };
    const region = findHitRegion(current.regions, point, rect.width / rect.height);
    if (region) {
      if (found.includes(region.id)) {
        setFeedback('이미 찾은 곳이에요.');
        return;
      }
      const next = [...found, region.id];
      setFound(next);
      const puzzleDone = countFoundInPuzzle(current, next) === current.regions.length;
      const allDone = next.length >= total;
      setFeedback(
        allDone
          ? `찾았어요! ${region.label}. 모두 찾았어요. 찾은 결과를 제출해요.`
          : puzzleDone && many
            ? `찾았어요! ${region.label}. 이 그림은 다 찾았어요. 다음 그림으로 넘어가요.`
            : `찾았어요! ${region.label}`,
      );
      playEffect(allDone ? 'fanfare' : puzzleDone ? 'card' : 'success');
      return;
    }
    missSeq.current += 1;
    const marker = { id: missSeq.current, ...point };
    setMisses((previous) => [...previous.slice(-2), marker]);
    setWrongTaps((value) => value + 1);
    setFeedback('여기는 아니에요.');
    playEffect('error');
  };

  const handleSubmit = () => {
    const isCurrentRound = event.activeGrade === team.grade && event.activeRound === roundNo;
    const remainingSeconds =
      isCurrentRound && event.status === 'active' && event.roundEndsAt !== null
        ? // 남은 시간 보너스는 서버 기준 시각으로 계산한다.
          Math.max(0, Math.floor((event.roundEndsAt - repository.serverNow()) / 1000))
        : 0;
    void submit({ type: 'error_hunt', foundRegionIds: found, wrongTaps, remainingSeconds });
  };

  return (
    <MissionShell
      mission={mission}
      team={team}
      roundNo={roundNo}
      event={event}
      phase={phase}
      notice={<MissionNotice phase={phase} event={event} view={view} error={error} />}
      actions={
        <>
          <div className="hunt-stats" aria-live="polite">
            <StatusBadge tone="success" icon="check_circle" size="lg">
              찾은 곳 {foundCount}/{total}
            </StatusBadge>
            <StatusBadge tone="danger" icon="close" size="lg">
              오답 {wrongTaps}번
            </StatusBadge>
          </div>
          {saved ? (
            <StatusBadge tone="info" icon="lock" size="lg">
              제출 완료
            </StatusBadge>
          ) : (
            <Button
              size="xl"
              icon="send"
              onClick={handleSubmit}
              disabled={!canSubmitInPhase(phase)}
              loading={isPending}
              loadingLabel="제출하는 중"
            >
              찾은 결과 제출
            </Button>
          )}
        </>
      }
    >
      <div className="hunt">
        {hidden ? (
          // 실제 그림은 화면에 올리지 않는다. 흐린 배경은 미션 안내 삽화다.
          <div className="hunt-board hunt-board--hidden">
            <AssetImage
              asset="missionErrorHunt"
              decorative
              className="hunt-board__image hunt-board__image--blur"
              loading="eager"
              draggable={false}
            />
            <div className="hunt-cover">
              <Icon name="lock" size="xl" />
              <p className="hunt-cover__title">게임이 시작되면 그림이 나타나요</p>
              <p className="hunt-cover__text">
                그림 {puzzles.length}장에서 이상한 곳 {total}군데를 찾아요.
              </p>
            </div>
          </div>
        ) : (
          <div
            className={`hunt-board${editable ? '' : ' hunt-board--locked'}`}
            onClick={handleTap}
            role="presentation"
          >
            <AssetImage
              // 그림을 넘기면 앞 그림이 잠깐 남지 않게 새로 그린다.
              key={current.id}
              asset={current.imageKey}
              className="hunt-board__image"
              loading="eager"
              draggable={false}
            />
            {current.regions
              .filter((region) => found.includes(region.id))
              .map((region) => (
                <HuntRegionMarker key={region.id} region={region} className="hunt-marker--found">
                  <Icon name="check" size="lg" />
                  <span className="visually-hidden">{region.label} 찾음</span>
                </HuntRegionMarker>
              ))}
            {misses.map((miss) => (
              <span
                key={miss.id}
                className="hunt-marker hunt-marker--miss"
                style={{ left: `${miss.x * 100}%`, top: `${miss.y * 100}%` }}
                aria-hidden="true"
              >
                <Icon name="close" size="lg" />
              </span>
            ))}
          </div>
        )}

        <aside className="hunt-side" aria-label="그림 안내">
          <p className="hunt-instruction">
            <Icon name="touch_app" />
            {many
              ? `이상한 곳을 그림마다 ${current.regions.length}군데씩 찾아 눌러요.`
              : config.instruction}
          </p>

          {hidden ? (
            <ul className="hunt-rules">
              <li>
                <Icon name="image" /> 그림은 모두 {puzzles.length}장이에요.
              </li>
              <li>
                <Icon name="search" /> 그림마다 이상한 곳이 {current.regions.length}군데 있어요.
              </li>
              <li>
                <Icon name="arrow_forward" /> 다 찾으면 다음 그림으로 넘어가요.
              </li>
            </ul>
          ) : null}

          {many && !hidden ? (
            <nav className="hunt-steps" aria-label="그림 번호">
              {puzzles.map((puzzle, puzzleIndex) => {
                const count = countFoundInPuzzle(puzzle, found);
                const done = count === puzzle.regions.length;
                return (
                  <button
                    key={puzzle.id}
                    type="button"
                    className={`hunt-step${done ? ' hunt-step--done' : ''}`}
                    aria-current={puzzleIndex === currentIndex ? 'step' : undefined}
                    aria-label={`${puzzleIndex + 1}번 그림 ${puzzle.title}, ${puzzle.regions.length}곳 중 ${count}곳 찾음`}
                    onClick={() => goTo(puzzleIndex)}
                  >
                    <span className="hunt-step__no number">{puzzleIndex + 1}</span>
                    <span className="hunt-step__count number">
                      {done ? <Icon name="check" size="sm" /> : null}
                      {count}/{puzzle.regions.length}
                    </span>
                  </button>
                );
              })}
            </nav>
          ) : null}

          {/* 그림 제목도 실마리가 되므로 가린 동안에는 목록을 그리지 않는다. */}
          {hidden ? null : (
            <section className="hunt-list" aria-labelledby="hunt-list-title">
              <h2 id="hunt-list-title" className="hunt-list__title">
                {many ? `${currentIndex + 1}번 그림 · ${current.title}` : '찾은 곳'}
                <span className="hunt-list__count number">
                  {currentFound}/{current.regions.length}
                </span>
              </h2>
              <ul className="hunt-list__items">
                {current.regions.map((region, regionIndex) => {
                  const isFound = found.includes(region.id);
                  return (
                    <li
                      key={region.id}
                      className={`hunt-list__item${isFound ? ' hunt-list__item--found' : ''}`}
                    >
                      <Icon name={isFound ? 'check_circle' : 'help'} />
                      {/* 찾기 전에는 이름을 알려 주지 않는다. */}
                      {isFound ? region.label : `${regionIndex + 1}번째 곳을 찾아요`}
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          {many && !hidden ? (
            <div className="hunt-pager">
              <Button
                variant="secondary"
                size="lg"
                icon="arrow_back"
                disabled={currentIndex === 0}
                onClick={() => goTo(currentIndex - 1)}
              >
                이전 그림
              </Button>
              <Button
                variant={currentDone ? 'primary' : 'secondary'}
                size="lg"
                iconEnd="arrow_forward"
                disabled={isLast}
                onClick={() => goTo(currentIndex + 1)}
              >
                다음 그림
              </Button>
            </div>
          ) : null}

          <p className="hunt-bonus">
            <Icon name="bolt" size="sm" />
            {total}곳을 모두 찾고 제출하면 남은 시간만큼 보너스 점수! 틀리게 누르면 감점이에요.
          </p>
        </aside>
      </div>
      <p className="visually-hidden" aria-live="assertive">
        {feedback}
      </p>
    </MissionShell>
  );
}
