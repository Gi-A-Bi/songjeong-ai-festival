import { useEffect, useRef, useState } from 'react';
import { Button } from '../../../components/Button';
import { Icon } from '../../../components/Icon';
import { renderPhoto } from './drawing';

interface CameraViewProps {
  /** 찍은 장면을 제출용 크기의 캔버스로 넘긴다. */
  onShot: (photo: HTMLCanvasElement) => void;
  /** 카메라를 열지 못했을 때 사진 파일을 고르러 간다. */
  onPickFile: () => void;
  onClose: () => void;
}

/** 카메라를 고르는 동안에도 같은 화면을 유지하고, 카메라가 바뀌면 영상만 새로 연다. */
export function CameraView({ onShot, onPickFile, onClose }: CameraViewProps) {
  const [deviceIds, setDeviceIds] = useState<string[]>([]);
  /** 교사·학생이 고른 카메라. null이면 브라우저가 고른 카메라(뒤쪽 카메라 우선)를 쓴다. */
  const [requestedId, setRequestedId] = useState<string | null>(null);
  /** 지금 열려 있는 카메라. 다음 카메라로 넘어갈 때 기준이 된다. */
  const [openedId, setOpenedId] = useState<string | null>(null);

  const switchCamera = () => {
    if (deviceIds.length < 2) return;
    const index = deviceIds.indexOf(requestedId ?? openedId ?? '');
    setRequestedId(deviceIds[(index + 1) % deviceIds.length]);
  };

  return (
    <CameraStream
      key={requestedId ?? 'default'}
      deviceId={requestedId}
      canSwitch={deviceIds.length > 1}
      onDevices={(ids, current) => {
        setDeviceIds(ids);
        setOpenedId(current);
      }}
      onSwitch={switchCamera}
      onShot={onShot}
      onPickFile={onPickFile}
      onClose={onClose}
    />
  );
}

interface CameraStreamProps extends CameraViewProps {
  deviceId: string | null;
  canSwitch: boolean;
  onDevices: (deviceIds: string[], currentDeviceId: string | null) => void;
  onSwitch: () => void;
}

function CameraStream({
  deviceId,
  canSwitch,
  onDevices,
  onSwitch,
  onShot,
  onPickFile,
  onClose,
}: CameraStreamProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState<'starting' | 'ready' | 'failed'>('starting');
  const [shotFailed, setShotFailed] = useState(false);
  const devicesRef = useRef(onDevices);
  useEffect(() => {
    devicesRef.current = onDevices;
  });

  useEffect(() => {
    let stopped = false;
    let stream: MediaStream | null = null;
    const size = { width: { ideal: 1920 }, height: { ideal: 1080 } };
    navigator.mediaDevices
      .getUserMedia({
        audio: false,
        video: deviceId
          ? { deviceId: { exact: deviceId }, ...size }
          : { facingMode: { ideal: 'environment' }, ...size },
      })
      .then(async (opened) => {
        if (stopped) {
          opened.getTracks().forEach((track) => track.stop());
          return;
        }
        stream = opened;
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = opened;
        await video.play().catch(() => undefined);
        if (stopped) return;
        setStatus('ready');
        const devices = await navigator.mediaDevices.enumerateDevices().catch(() => []);
        if (stopped) return;
        devicesRef.current(
          devices
            .filter((device) => device.kind === 'videoinput' && device.deviceId !== '')
            .map((device) => device.deviceId),
          opened.getVideoTracks()[0]?.getSettings().deviceId ?? null,
        );
      })
      .catch(() => {
        if (!stopped) setStatus('failed');
      });
    return () => {
      stopped = true;
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [deviceId]);

  const shoot = () => {
    const video = videoRef.current;
    const photo = video ? renderPhoto(video, video.videoWidth, video.videoHeight) : null;
    if (!photo) {
      setShotFailed(true);
      return;
    }
    onShot(photo);
  };

  if (status === 'failed') {
    return (
      <div className="photo-camera">
        <div className="photo-camera__failed" role="alert">
          <Icon name="warning" size="lg" />
          <p>
            카메라를 열지 못했어요. 카메라 사용을 허락했는지 확인하거나, “사진 파일 고르기”로 보내
            주세요.
          </p>
        </div>
        <div className="photo-camera__actions">
          <Button variant="secondary" size="lg" icon="close" onClick={onClose}>
            닫기
          </Button>
          <Button size="lg" icon="image" onClick={onPickFile}>
            사진 파일 고르기
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="photo-camera">
      <video
        ref={videoRef}
        className="photo-camera__video"
        aria-label="카메라 화면"
        playsInline
        muted
      />
      {shotFailed ? (
        <p className="photo-camera__hint" role="alert">
          사진을 찍지 못했어요. 잠시 뒤 다시 눌러 주세요.
        </p>
      ) : (
        <p className="photo-camera__hint">
          <Icon name="info" />
          그림이 화면에 가득 차게 맞춰요. 이름과 얼굴은 나오면 안 돼요.
        </p>
      )}
      <div className="photo-camera__actions">
        <Button variant="secondary" size="lg" icon="close" onClick={onClose}>
          닫기
        </Button>
        {canSwitch ? (
          <Button variant="secondary" size="lg" icon="cameraswitch" onClick={onSwitch}>
            카메라 바꾸기
          </Button>
        ) : null}
        <Button size="xl" icon="photo_camera" onClick={shoot} disabled={status !== 'ready'}>
          찰칵! 찍기
        </Button>
      </div>
    </div>
  );
}
