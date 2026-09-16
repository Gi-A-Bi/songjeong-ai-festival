import { paths } from '../../app/paths';
import { AppHeader } from '../../components/AppHeader';
import { AssetImage } from '../../components/AssetImage';
import { ButtonLink } from '../../components/Button';
import { DEFAULT_EVENT_ID } from '../../config';
import './StartPage.css';

export function StartPage() {
  return (
    <>
      <AppHeader />
      <main className="start">
        <AssetImage asset="heroMain" className="start__hero" loading="eager" fetchPriority="high" />
        <div className="start__shade" aria-hidden="true" />
        <div className="start__content">
          <p className="start__eyebrow">서울송정초등학교 · 3~6학년</p>
          <h1 className="start__title">
            2026
            <br />
            송정 AI 페스티벌
          </h1>
          <p className="start__lead">5개 미션 교실을 돌며 AI 능력 카드를 모아요!</p>
          <ButtonLink
            to={paths.join(DEFAULT_EVENT_ID)}
            size="xl"
            icon="rocket_launch"
            className="start__cta"
          >
            AI 미션 투어 시작
          </ButtonLink>
        </div>
        <ButtonLink
          to={paths.teacherLogin()}
          variant="secondary"
          icon="school"
          className="start__teacher"
        >
          교사용
        </ButtonLink>
      </main>
    </>
  );
}
