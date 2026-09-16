import { useRef, useState, type MouseEvent } from 'react';
import { paths } from '../../../app/paths';
import { useSettings } from '../../../app/SettingsContext';
import { AssetImage } from '../../../components/AssetImage';
import { Button } from '../../../components/Button';
import { Icon } from '../../../components/Icon';
import { MissionShell } from '../../../components/MissionShell';
import { StatusBadge } from '../../../components/StatusBadge';
import { canSubmitInPhase } from '../../../domain/missionPhase';
import { findHitRegion } from '../../../domain/scoring';
import type { ErrorHuntConfig } from '../../../domain/types';
import { MissionNotice } from '../MissionNotice';
import type { MissionScreenProps } from '../missionTypes';
import { useMissionSubmit } from '../useMissionSubmit';
import '../Missions.css';
import './ErrorHunt.css';

interface ErrorHuntMissionProps extends MissionScreenProps {
  config: ErrorHuntConfig;
}

interface MissMarker {
  id: number;
  x: number;
  y: number;
}

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
  const saved = submission?.answer.type === 'error_hunt' ? submission.answer : null;
  const [found, setFound] = useState<string[]>(saved?.foundRegionIds ?? []);
  const [wrongTaps, setWrongTaps] = useState(saved?.wrongTaps ?? 0);
  const [misses, setMisses] = useState<MissMarker[]>([]);
  const [feedback, setFeedback] = useState('');
  const missSeq = useRef(0);
  const { submit, isPending, error } = useMissionSubmit(eventId, team.id, mission.id, onSubmitted);

  const editable = canSubmitInPhase(phase) && saved === null && !isPending;
  const total = config.regions.length;

  const handleTap = (tap: MouseEvent<HTMLDivElement>) => {
    if (!editable) return;
    const rect = tap.currentTarget.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const point = {
      x: (tap.clientX - rect.left) / rect.width,
      y: (tap.clientY - rect.top) / rect.height,
    };
    const region = findHitRegion(config.regions, point, rect.width / rect.height);
    if (region) {
      if (found.includes(region.id)) {
        setFeedback('이미 찾은 곳이에요.');
        return;
      }
      setFound((previous) => [...previous, region.id]);
      setFeedback(`찾았어요! ${region.label}`);
      playEffect('success');
      return;
    }
    missSeq.current += 1;
    const marker = { id: missSeq.current, ...point };
    setMisses((previous) => [...previous.slice(-2), marker]);
    setWrongTaps((value) => value + 1);
    setFeedback('여기는 아니에요.');
    playEffect('tap');
  };

  const handleSubmit = () => {
    const isCurrentRound = event.activeGrade === team.grade && event.activeRound === roundNo;
    const remainingSeconds =
      isCurrentRound && event.status === 'active' && event.roundEndsAt !== null
        ? Math.max(0, Math.floor((event.roundEndsAt - Date.now()) / 1000))
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
      notice={
        <MissionNotice
          phase={phase}
          event={event}
          error={error}
          teacherJudged={mission.teacherJudged}
          cardsPath={paths.cards(eventId, team.id)}
        />
      }
      actions={
        <>
          <div className="hunt-stats" aria-live="polite">
            <StatusBadge tone="success" icon="check_circle" size="lg">
              찾은 곳 {found.length}/{total}
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
      <p className="hunt-instruction">
        <Icon name="touch_app" />
        {config.instruction}
      </p>
      <div
        className={`hunt-board${editable ? '' : ' hunt-board--locked'}`}
        onClick={handleTap}
        role="presentation"
      >
        <AssetImage
          asset={config.imageKey}
          className="hunt-board__image"
          loading="eager"
          draggable={false}
        />
        {config.regions
          .filter((region) => found.includes(region.id))
          .map((region) => (
            <span
              key={region.id}
              className="hunt-marker hunt-marker--found"
              style={{
                left: `${region.x * 100}%`,
                top: `${region.y * 100}%`,
                width: `${region.r * 200}%`,
              }}
            >
              <Icon name="check" size="lg" />
              <span className="visually-hidden">{region.label} 찾음</span>
            </span>
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
      <p className="visually-hidden" aria-live="assertive">
        {feedback}
      </p>
    </MissionShell>
  );
}
