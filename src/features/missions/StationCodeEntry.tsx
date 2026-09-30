import { useCallback, useEffect, useId, useState, type FormEvent } from 'react';
import { useSettings } from '../../app/SettingsContext';
import { Button } from '../../components/Button';
import { Icon } from '../../components/Icon';
import { InlineAlert } from '../../components/StateViews';
import { toUserMessage } from '../../data/errors';
import { useRepository } from '../../data/RepositoryContext';
import { missionRoom } from '../../domain/missionRoom';
import {
  isValidStationCode,
  normalizeStationCode,
  STATION_CODE_COOLDOWN_MS,
  STATION_CODE_LENGTH,
  STATION_CODE_MAX_TRIES,
} from '../../domain/stationCode';
import type { Mission, RoundNo, Team } from '../../domain/types';
import { useAction } from '../../hooks/useAction';
import './Missions.css';

interface StationCodeEntryProps {
  eventId: string;
  team: Team;
  mission: Mission;
  roundNo: RoundNo;
  onCheckedIn: () => void;
  /** 선생님이 직접 입장 처리했을 때 화면을 다시 읽는다. */
  onRefresh: () => void;
}

/**
 * 교실 인증코드 입력. 교실 선생님이 알려 준 네 자리 숫자를 넣으면 입장이 기록된다.
 * 연달아 틀리면 잠깐 기다리게 해 마구 눌러 맞히지 못하게 한다.
 */
export function StationCodeEntry({
  eventId,
  team,
  mission,
  roundNo,
  onCheckedIn,
  onRefresh,
}: StationCodeEntryProps) {
  const repository = useRepository();
  const { playEffect } = useSettings();
  const inputId = useId();
  const [code, setCode] = useState('');
  const [misses, setMisses] = useState(0);
  const [lockedUntil, setLockedUntil] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const checkIn = useAction(
    useCallback(
      (accessCode: string) =>
        repository.checkInStation({ eventId, teamId: team.id, stationId: mission.id, accessCode }),
      [repository, eventId, team.id, mission.id],
    ),
  );

  // 기다리는 동안 남은 초를 보여 준다.
  const locked = lockedUntil !== null && now < lockedUntil;
  useEffect(() => {
    if (!locked) return undefined;
    const id = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(id);
  }, [locked]);

  const submit = async (submitEvent: FormEvent<HTMLFormElement>) => {
    submitEvent.preventDefault();
    if (locked || checkIn.isPending || !isValidStationCode(code)) return;
    const result = await checkIn.run(code);
    if (!result) return;
    if (result.ok) {
      playEffect('arrive');
      onCheckedIn();
      return;
    }
    playEffect('error');
    setCode('');
    const next = misses + 1;
    setMisses(next);
    if (next >= STATION_CODE_MAX_TRIES) {
      setMisses(0);
      setLockedUntil(Date.now() + STATION_CODE_COOLDOWN_MS);
      setNow(Date.now());
    }
  };

  const waitSeconds = locked ? Math.ceil((lockedUntil - now) / 1000) : 0;

  return (
    <form className="code-entry" onSubmit={(submitEvent) => void submit(submitEvent)}>
      <div className="code-entry__lead">
        <Icon name="meeting_room" size="lg" />
        <div>
          <p className="code-entry__title">
            {roundNo}라운드 · {missionRoom(mission, team.grade)}에 도착했나요?
          </p>
          <p className="code-entry__hint">
            교실 선생님이 알려 준 <strong>인증코드 숫자 {STATION_CODE_LENGTH}자리</strong>를 넣으면
            입장돼요.
          </p>
        </div>
      </div>
      <div className="code-entry__row">
        <label htmlFor={inputId} className="visually-hidden">
          교실 인증코드
        </label>
        <input
          id={inputId}
          className="code-entry__input number"
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={STATION_CODE_LENGTH}
          placeholder="0000"
          value={code}
          disabled={locked || checkIn.isPending}
          aria-invalid={checkIn.status === 'error' || undefined}
          onChange={(change) => setCode(normalizeStationCode(change.target.value))}
        />
        <Button
          type="submit"
          size="xl"
          icon="login"
          disabled={locked || !isValidStationCode(code)}
          loading={checkIn.isPending}
          loadingLabel="입장하는 중"
        >
          입장하기
        </Button>
      </div>
      {locked ? (
        <InlineAlert tone="warning" icon="hourglass_top">
          인증코드가 여러 번 달랐어요. {waitSeconds}초 뒤에 다시 넣어 주세요. 코드는 교실 선생님께
          확인해요.
        </InlineAlert>
      ) : checkIn.status === 'error' ? (
        <InlineAlert tone="danger">{toUserMessage(checkIn.error)}</InlineAlert>
      ) : null}
      <p className="code-entry__refresh">
        코드를 넣기 어려우면 선생님께 말해요. 선생님이 직접 입장 처리해 주셨다면{' '}
        <Button variant="ghost" icon="refresh" onClick={onRefresh}>
          다시 확인
        </Button>
      </p>
    </form>
  );
}
