import { useEffect, useState } from 'react';
import { useSettings } from '../../../app/SettingsContext';
import { Button } from '../../../components/Button';
import { Confetti } from '../../../components/Confetti';
import { Icon } from '../../../components/Icon';
import { MissionShell } from '../../../components/MissionShell';
import { StatusBadge } from '../../../components/StatusBadge';
import {
  calculateOzobotScore,
  findOzobotChallenge,
  getOzobotMinutes,
  getOzobotSolved,
  OZOBOT_LEVELS,
  OZOBOT_POINTS,
  ozobotChallengesOf,
  ozobotStars,
  pickOzobotChallenge,
  type OzobotLevel,
} from '../../../domain/ozobot';
import type { OzobotConfig } from '../../../domain/types';
import { getMissionLock } from '../missionLock';
import { MissionLockedPanel } from '../MissionLockedPanel';
import { MissionNotice } from '../MissionNotice';
import type { MissionScreenProps } from '../missionTypes';
import '../Missions.css';
import { OzobotChallengeCard } from './OzobotChallengeCard';
import './Ozobot.css';

interface OzobotMissionProps extends MissionScreenProps {
  config: OzobotConfig;
}

/** 새로고침해도 지금 받은 카드가 바뀌지 않게 이 기기에 잠깐 기억한다. */
function readCurrent(key: string): string | null {
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeCurrent(key: string, value: string | null): void {
  try {
    if (value === null) window.sessionStorage.removeItem(key);
    else window.sessionStorage.setItem(key, value);
  } catch {
    // 저장소를 쓸 수 없는 기기에서도 화면은 그대로 동작한다.
  }
}

/**
 * 로봇 길찾기. 난이도(별 1~3개)를 고르면 그 난이도의 도전 과제 카드가 무작위로 나온다.
 * 팀은 실제 보드판에 길 조각을 이어 길을 만들고, 선생님이 오조봇으로 확인해 성공을 기록한다.
 * 학생 기기는 기록하지 않고, 선생님이 기록하면 점수와 다음 카드 고르기가 바로 보인다.
 */
export function OzobotMission({ eventId, view, event, phase, gate, config }: OzobotMissionProps) {
  const { team, mission, submission, roundNo } = view;
  const { playEffect } = useSettings();
  const lock = getMissionLock(view, event, phase);
  const solved = getOzobotSolved(submission?.answer.type === 'ozobot' ? submission.answer : null);
  const solvedIds = solved.map((item) => item.challengeId);
  const score = calculateOzobotScore(solved);
  const storageKey = `ozobot:${eventId}:${team.id}:${mission.id}`;
  const [currentId, setCurrentId] = useState<string | null>(() => readCurrent(storageKey));
  /** 방금 성공한 카드(축하 연출) */
  const [celebrated, setCelebrated] = useState<string | null>(null);

  // 게임 중이면(성공 기록이 있어도) 계속 도전할 수 있다. 시간이 끝나면 멈춘다.
  const playing = (phase === 'active' || phase === 'submitted') && lock === null;
  const current = currentId ? findOzobotChallenge(currentId) : undefined;
  const currentSolved = current !== undefined && solvedIds.includes(current.id);

  // 선생님이 지금 카드의 성공을 기록하면 축하하고 다음 카드를 고르게 한다.
  // (기록이 바뀌면 화면을 새로 그리므로 이 기기에 기억한 카드로 알아챈다.)
  if (current && currentSolved) {
    setCelebrated(current.id);
    setCurrentId(null);
  }
  useEffect(() => {
    writeCurrent(storageKey, currentId);
  }, [storageKey, currentId]);
  useEffect(() => {
    if (celebrated) playEffect('fanfare');
  }, [celebrated, playEffect]);

  const choose = (level: OzobotLevel) => {
    const next = pickOzobotChallenge(level, solvedIds, currentId);
    if (!next) return;
    playEffect('card');
    setCelebrated(null);
    setCurrentId(next.id);
  };

  const celebratedCard = celebrated ? findOzobotChallenge(celebrated) : undefined;
  const minutes = getOzobotMinutes(config);

  return (
    <MissionShell
      mission={mission}
      team={team}
      roundNo={roundNo}
      event={event}
      phase={phase}
      // 성공 기록은 선생님이 남기므로 "제출했어요" 안내 대신 진행 중으로 안내한다.
      notice={
        <MissionNotice
          phase={phase === 'submitted' ? 'active' : phase}
          event={event}
          view={view}
          error={null}
        />
      }
      gate={gate}
      actions={
        <>
          <p className="mission-actions__hint">
            <Icon name="smart_toy" />
            길을 다 만들면 손을 들어 선생님을 불러요
          </p>
          <StatusBadge tone="success" icon="trophy" size="lg">
            우리 팀 {score}점 · 성공 {solved.length}개
          </StatusBadge>
        </>
      }
    >
      {lock !== null ? (
        <MissionLockedPanel mission={mission} reason={lock} subject="도전 과제 카드가">
          <p>
            난이도를 골라 도전 과제를 받고, 보드판에 길 조각을 이어 길을 만들어요. {minutes}분 동안
            성공한 카드의 별 점수를 모아요.
          </p>
          <p>★ 5점 · ★★ 10점 · ★★★ 20점</p>
        </MissionLockedPanel>
      ) : (
        <div className="ozobot-play">
          <section className="stack" aria-labelledby="ozobot-main-title">
            {celebratedCard ? (
              <p className="ozobot-success" role="status">
                <Confetti count={30} />
                <Icon name="celebration" size="lg" /> 도전 과제 {celebratedCard.cardNo} 성공! +
                {OZOBOT_POINTS[celebratedCard.level]}점
              </p>
            ) : null}

            {current && !currentSolved ? (
              <div className="ozobot-current">
                <div className="ozobot-current__head">
                  <h2 id="ozobot-main-title" className="section-title">
                    <Icon name="flag" /> 이 길을 만들어요
                  </h2>
                  <Button
                    variant="secondary"
                    icon="arrow_back"
                    disabled={!playing}
                    onClick={() => setCurrentId(null)}
                  >
                    난이도 다시 고르기
                  </Button>
                </div>
                <OzobotChallengeCard challenge={current} wide />
              </div>
            ) : (
              <>
                <h2 id="ozobot-main-title" className="section-title">
                  <Icon name="stars" /> 난이도를 골라요
                </h2>
                <p className="muted">
                  고르면 그 난이도의 도전 과제 카드가 무작위로 나와요. 성공한 카드는 다시 나오지
                  않아요.
                </p>
                <div className="ozobot-levels" role="group" aria-label="난이도 고르기">
                  {OZOBOT_LEVELS.map((level) => {
                    const left = ozobotChallengesOf(level).filter(
                      (item) => !solvedIds.includes(item.id),
                    ).length;
                    return (
                      <button
                        key={level}
                        type="button"
                        className={`ozobot-level ozobot-level--${level}`}
                        disabled={!playing || left === 0}
                        aria-label={`별 ${level}개, ${OZOBOT_POINTS[level]}점, 남은 카드 ${left}장`}
                        onClick={() => choose(level)}
                      >
                        <span className="ozobot-level__stars" aria-hidden="true">
                          {ozobotStars(level)}
                        </span>
                        <span className="ozobot-level__points">{OZOBOT_POINTS[level]}점</span>
                        <span className="ozobot-level__left">
                          {left > 0 ? `남은 카드 ${left}장` : '모두 성공!'}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </section>

          <aside className="ozobot-side" aria-label="도전 방법과 점수">
            <ol className="ozobot-steps">
              <li>난이도를 골라 도전 과제 카드를 받아요.</li>
              <li>보드판의 출발 칸에서 도착 칸까지 카드에 나온 길 조각으로 길을 이어요.</li>
              <li>다 만들면 손을 들어요. 선생님이 오조봇을 올려 확인해요.</li>
              <li>성공하면 점수가 올라가고 다음 카드를 골라요.</li>
            </ol>
            <section className="ozobot-score" aria-labelledby="ozobot-score-title">
              <p id="ozobot-score-title" className="ozobot-score__total">
                우리 팀 점수 <strong className="number">{score}</strong>점
              </p>
              {solved.length > 0 ? (
                <ul className="ozobot-chips" aria-label="성공한 도전 과제">
                  {solved.map((item) => {
                    const card = findOzobotChallenge(item.challengeId);
                    return (
                      <li key={item.challengeId} className="ozobot-chip">
                        <Icon name="check_circle" size="sm" />
                        {card ? `카드 ${card.cardNo}` : item.challengeId} {ozobotStars(item.level)}{' '}
                        +{OZOBOT_POINTS[item.level]}
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="muted">아직 성공한 카드가 없어요. ★ 5점 · ★★ 10점 · ★★★ 20점</p>
              )}
            </section>
          </aside>
        </div>
      )}
    </MissionShell>
  );
}
