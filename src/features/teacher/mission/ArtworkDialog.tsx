import { AssetImage } from '../../../components/AssetImage';
import { Button } from '../../../components/Button';
import { Dialog } from '../../../components/Dialog';
import { Icon } from '../../../components/Icon';
import { drawingArtworkLabel } from '../../../domain/drawingPrompts';
import type { DrawingPrompt } from '../../../domain/types';

interface ArtworkDialogProps {
  prompt: DrawingPrompt | null;
  onClose: () => void;
}

/** 전자칠판에 띄워 함께 감상하는 원작 명화와 그림 프롬프트 */
export function ArtworkDialog({ prompt, onClose }: ArtworkDialogProps) {
  return (
    <Dialog
      open={prompt !== null}
      title={prompt ? drawingArtworkLabel(prompt) : ''}
      size="xl"
      onClose={onClose}
      footer={
        <Button size="lg" icon="close" onClick={onClose} data-autofocus>
          닫기
        </Button>
      }
    >
      {prompt ? (
        <div className="artwork-view">
          {prompt.imageKey ? (
            <AssetImage asset={prompt.imageKey} className="artwork-view__image" loading="eager" />
          ) : (
            <p className="artwork-view__empty">
              <Icon name="image" size="lg" />
              원작 그림이 준비되지 않았어요. 따로 준비한 자료로 감상해 주세요.
            </p>
          )}
          <div className="artwork-view__notes">
            <p className="artwork-view__technique">
              <Icon name="brush" />
              함께 볼 표현 기법: <strong>{prompt.technique}</strong>
            </p>
            <h3 className="artwork-view__label">
              <Icon name="smart_toy" /> 그림 프롬프트
            </h3>
            <p className="artwork-view__prompt">{prompt.text}</p>
          </div>
        </div>
      ) : null}
    </Dialog>
  );
}
