import { useCallback, useState } from 'react';
import { Button } from '../../components/Button';
import { ConfirmDialog } from '../../components/Dialog';
import { Icon } from '../../components/Icon';
import { EmptyView, ErrorView, InlineAlert, LoadingView } from '../../components/StateViews';
import type { TeamDevice } from '../../data/EventRepository';
import { toUserMessage } from '../../data/errors';
import { useRepository } from '../../data/RepositoryContext';
import type { Team } from '../../domain/types';
import { useAction } from '../../hooks/useAction';
import { useAsyncData } from '../../hooks/useAsyncData';
import { formatTimeOfDay } from '../../lib/time';

interface ClassDevicesPanelProps {
  eventId: string;
  classId: string;
  teams: readonly Team[];
}

/**
 * 팀을 잘못 고른 기기의 잠금 해제. 기기 목록은 버튼을 눌렀을 때만 읽는다
 * (학급 화면을 열 때마다 읽지 않아 무료 사용량을 아낀다).
 */
export function ClassDevicesPanel({ eventId, classId, teams }: ClassDevicesPanelProps) {
  const [opened, setOpened] = useState(false);
  return (
    <section className="panel stack" aria-labelledby="class-devices-title">
      <div className="teacher-title">
        <h2 id="class-devices-title" className="section-title">
          <Icon name="lock_open" /> 팀 기기 잠금 해제
        </h2>
        {opened ? null : (
          <Button variant="secondary" icon="search" onClick={() => setOpened(true)}>
            입장한 기기 보기
          </Button>
        )}
      </div>
      <p className="muted">
        디벗이 다른 팀으로 잘못 입장했을 때 써요. 학생 화면에 보이는 기기 번호와 같은 줄에서 잠금을
        풀면, 그 기기는 다시 팀을 골라 입장할 수 있어요.
      </p>
      {opened ? <DeviceList eventId={eventId} classId={classId} teams={teams} /> : null}
    </section>
  );
}

function DeviceList({ eventId, classId, teams }: ClassDevicesPanelProps) {
  const repository = useRepository();
  const load = useCallback(
    () => repository.listClassDevices(eventId, classId),
    [repository, eventId, classId],
  );
  const devices = useAsyncData(load);
  const [target, setTarget] = useState<TeamDevice | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const unlock = useAction(
    useCallback(
      (deviceId: string) => repository.unlockDevice(eventId, deviceId),
      [repository, eventId],
    ),
  );
  const teamName = (teamId: string) =>
    teams.find((team) => team.id === teamId)?.displayName ?? teamId;

  if (devices.status === 'loading') return <LoadingView label="입장한 기기를 불러오고 있어요" />;
  if (devices.status === 'error') {
    return <ErrorView error={devices.error} onRetry={devices.reload} />;
  }

  return (
    <>
      {notice ? <InlineAlert tone="success">{notice}</InlineAlert> : null}
      {unlock.status === 'error' ? (
        <InlineAlert tone="danger">{toUserMessage(unlock.error)}</InlineAlert>
      ) : null}
      {devices.data.length === 0 ? (
        <EmptyView title="아직 이 반 팀으로 입장한 기기가 없어요" icon="groups" />
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">팀</th>
                <th scope="col">기기 번호</th>
                <th scope="col">입장 시각</th>
                <th scope="col">마지막 접속</th>
                <th scope="col">관리</th>
              </tr>
            </thead>
            <tbody>
              {devices.data.map((device) => (
                <tr key={device.id}>
                  <th scope="row">{teamName(device.teamId)}</th>
                  <td>
                    <strong className="number">{device.code}</strong>
                  </td>
                  <td className="number">{formatTimeOfDay(device.joinedAt)}</td>
                  <td className="number">{formatTimeOfDay(device.lastSeenAt)}</td>
                  <td>
                    <Button
                      variant="secondary"
                      icon="lock_open"
                      disabled={unlock.isPending}
                      onClick={() => setTarget(device)}
                    >
                      잠금 해제
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Button variant="ghost" icon="refresh" onClick={devices.reload}>
        기기 목록 새로고침
      </Button>

      <ConfirmDialog
        open={target !== null}
        title={target ? `기기 ${target.code}의 잠금을 풀까요?` : ''}
        confirmLabel="잠금 해제"
        confirmIcon="lock_open"
        loading={unlock.isPending}
        onCancel={() => setTarget(null)}
        onConfirm={async () => {
          if (!target) return;
          const result = await unlock.run(target.id);
          setTarget(null);
          if (result?.ok) {
            setNotice(
              `기기 ${target.code}의 잠금을 풀었어요. 그 기기에서 팀을 다시 골라 입장해 주세요.`,
            );
            devices.reload();
          }
        }}
      >
        <p>
          {target ? teamName(target.teamId) : ''}으로 입장한 기기예요. 잠금을 풀면 이 기기는 다시
          팀을 골라 입장해야 해요.
        </p>
        <p className="muted">팀이 이미 낸 제출과 카드, 도착 기록은 그대로 남아요.</p>
      </ConfirmDialog>
    </>
  );
}
