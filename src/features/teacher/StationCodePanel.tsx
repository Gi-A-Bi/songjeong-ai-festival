import { useCallback, useState } from 'react';
import { paths } from '../../app/paths';
import { Button, ButtonLink } from '../../components/Button';
import { Icon } from '../../components/Icon';
import { InlineAlert } from '../../components/StateViews';
import { StatusBadge } from '../../components/StatusBadge';
import type { StationCodeList } from '../../data/EventRepository';
import { toUserMessage } from '../../data/errors';
import { useRepository } from '../../data/RepositoryContext';
import {
  createRandomStationCodes,
  getStationCodesError,
  normalizeStationCode,
  STATION_CODE_LENGTH,
} from '../../domain/stationCode';
import { missionRoom } from '../../domain/missionRoom';
import type { Mission } from '../../domain/types';
import { useAction } from '../../hooks/useAction';
import { useAsyncData } from '../../hooks/useAsyncData';

interface StationCodePanelProps {
  eventId: string;
}

function toDrafts(codes: StationCodeList): Record<string, string> {
  return Object.fromEntries(codes.map((item) => [item.missionId, item.code ?? '']));
}

/**
 * 행사 설정의 "교실 인증코드". 교실마다 네 자리 숫자를 정한다.
 * 학생은 미션 화면에서 이 코드를 넣고 입장하고, 부스 화면은 자기 교실 코드를 크게 보여 준다.
 */
export function StationCodePanel({ eventId }: StationCodePanelProps) {
  const repository = useRepository();
  const load = useCallback(async () => {
    const [missions, codes] = await Promise.all([
      repository.listMissions(eventId),
      repository.listStationCodes(eventId),
    ]);
    return { missions, codes };
  }, [repository, eventId]);
  const loaded = useAsyncData(load);
  const [drafts, setDrafts] = useState<Record<string, string> | null>(null);
  const [saved, setSaved] = useState(false);

  const save = useAction(
    useCallback(
      (codes: Record<string, string>) => repository.saveStationCodes(eventId, codes),
      [repository, eventId],
    ),
  );

  if (loaded.status === 'loading') {
    return (
      <section className="panel stack" aria-labelledby="admin-codes-title">
        <h2 id="admin-codes-title" className="section-title">
          <Icon name="login" /> 교실 인증코드
        </h2>
        <p className="muted">불러오는 중이에요.</p>
      </section>
    );
  }
  if (loaded.status === 'error') {
    return (
      <section className="panel stack" aria-labelledby="admin-codes-title">
        <h2 id="admin-codes-title" className="section-title">
          <Icon name="login" /> 교실 인증코드
        </h2>
        <InlineAlert tone="danger">{toUserMessage(loaded.error)}</InlineAlert>
      </section>
    );
  }

  const { missions, codes } = loaded.data;
  const stored = toDrafts(codes);
  const values = drafts ?? stored;
  const missing = codes.filter((item) => item.code === null).length;
  const dirty = missions.some((mission) => values[mission.id] !== stored[mission.id]);
  const inputError = getStationCodesError(values, missions);

  const update = (mission: Mission, text: string) => {
    setDrafts({ ...values, [mission.id]: normalizeStationCode(text) });
    setSaved(false);
    save.reset();
  };

  const randomize = () => {
    setDrafts(createRandomStationCodes(missions.map((mission) => mission.id)));
    setSaved(false);
    save.reset();
  };

  const handleSave = async () => {
    if (inputError) return;
    const result = await save.run(values);
    if (result?.ok) {
      setDrafts(null);
      setSaved(true);
      loaded.reload();
    }
  };

  return (
    <section className="panel stack" aria-labelledby="admin-codes-title">
      <h2 id="admin-codes-title" className="section-title">
        <Icon name="login" /> 교실 인증코드
        {missing > 0 ? (
          <StatusBadge tone="warning" icon="warning">
            정하지 않은 교실 {missing}곳
          </StatusBadge>
        ) : (
          <StatusBadge tone="success" icon="check_circle">
            모든 교실 준비됨
          </StatusBadge>
        )}
      </h2>
      <p className="muted">
        학생은 교실 QR 대신 미션 화면에서 그 교실의 인증코드(숫자 {STATION_CODE_LENGTH}자리)를 넣고
        입장합니다. 코드는 라운드마다 같고, 부스 화면에 크게 보여 선생님이 들어온 팀에게 알려
        줍니다. 학생 기기에는 내려가지 않습니다.
      </p>

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col">미션</th>
              <th scope="col">교실</th>
              <th scope="col">인증코드</th>
            </tr>
          </thead>
          <tbody>
            {missions.map((mission) => (
              <tr key={mission.id}>
                <th scope="row">
                  미션 {mission.no} · {mission.title}
                </th>
                <td>{missionRoom(mission, null)}</td>
                <td>
                  <input
                    className="table-input number station-code-input"
                    inputMode="numeric"
                    maxLength={STATION_CODE_LENGTH}
                    aria-label={`${missionRoom(mission, null)} 인증코드`}
                    placeholder="0000"
                    value={values[mission.id] ?? ''}
                    onChange={(change) => update(mission, change.target.value)}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {dirty && inputError ? <InlineAlert tone="danger">{inputError}</InlineAlert> : null}
      {save.status === 'error' ? (
        <InlineAlert tone="danger">{toUserMessage(save.error)}</InlineAlert>
      ) : null}
      {saved && !dirty ? (
        <InlineAlert tone="success">인증코드를 저장했어요. 부스 화면에 바로 보여요.</InlineAlert>
      ) : null}

      <div className="teacher-actions">
        <Button variant="secondary" size="lg" icon="casino" onClick={randomize}>
          무작위로 만들기
        </Button>
        <Button
          size="lg"
          icon="save"
          disabled={!dirty || inputError !== null}
          loading={save.isPending}
          onClick={() => void handleSave()}
        >
          인증코드 저장
        </Button>
        <ButtonLink to={paths.qrPrint(eventId)} variant="ghost" size="lg" icon="print">
          안내문 인쇄
        </ButtonLink>
      </div>
    </section>
  );
}
