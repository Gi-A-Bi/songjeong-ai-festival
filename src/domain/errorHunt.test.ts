import { describe, expect, it } from 'vitest';
import { assets } from '../assets/manifest';
import {
  countFoundInPuzzle,
  getErrorHuntBand,
  getErrorHuntPuzzles,
  getErrorHuntPuzzlesError,
  getErrorHuntRegions,
  getFirstOpenPuzzleIndex,
  getRegionRadiusY,
  isErrorHuntPictureHidden,
} from './errorHunt';
import { DEFAULT_ERROR_HUNT_PUZZLES } from './errorHuntPuzzles';
import { calculateAutoScore, findHitRegion } from './scoring';
import type { ErrorHuntBand, ErrorHuntConfig, ErrorHuntPuzzle, Grade } from './types';

const config: ErrorHuntConfig = {
  type: 'error_hunt',
  imageKey: 'missionErrorHunt',
  instruction: '이상한 곳을 찾아요.',
  regions: [{ id: 'common-1', x: 0.5, y: 0.5, r: 0.1, label: '공통 그림의 이상한 곳' }],
};

const BANDS: readonly ErrorHuntBand[] = ['grade3', 'grade4', 'grade56'];
const GRADES: readonly Grade[] = [3, 4, 5, 6];

describe('틀린그림 찾기 그림 묶음', () => {
  it('3학년, 4학년, 5·6학년 묶음으로 나눈다', () => {
    expect(GRADES.map(getErrorHuntBand)).toEqual(['grade3', 'grade4', 'grade56', 'grade56']);
  });

  it('묶음마다 그림 5장, 그림마다 이상한 곳 3군데가 있다', () => {
    for (const band of BANDS) {
      const puzzles = DEFAULT_ERROR_HUNT_PUZZLES[band];
      expect(puzzles).toHaveLength(5);
      for (const puzzle of puzzles) expect(puzzle.regions).toHaveLength(3);
      expect(getErrorHuntPuzzlesError(puzzles)).toBe(null);
    }
  });

  it('그림과 정답의 ID가 묶음을 통틀어 겹치지 않는다', () => {
    const puzzles = BANDS.flatMap((band) => DEFAULT_ERROR_HUNT_PUZZLES[band]);
    const puzzleIds = puzzles.map((puzzle) => puzzle.id);
    const regionIds = puzzles.flatMap((puzzle) => puzzle.regions.map((region) => region.id));
    const imageKeys = puzzles.map((puzzle) => puzzle.imageKey);
    expect(new Set(puzzleIds).size).toBe(15);
    expect(new Set(regionIds).size).toBe(45);
    expect(new Set(imageKeys).size).toBe(15);
  });

  it('정답 영역은 작은 화면에서도 누를 수 있는 크기다', () => {
    // 그림이 가장 작게 보일 때(너비 약 500px)에도 지름이 48px쯤 되게 한다.
    for (const band of BANDS) {
      for (const region of DEFAULT_ERROR_HUNT_PUZZLES[band].flatMap((puzzle) => puzzle.regions)) {
        expect(region.r, region.label).toBeGreaterThanOrEqual(0.05);
        expect(getRegionRadiusY(region, 16 / 9), region.label).toBeGreaterThanOrEqual(0.075);
      }
    }
  });

  it('그림 파일이 모두 들어 있다', () => {
    // 파일을 읽지 않고 이름만 모은다.
    const files = Object.keys(import.meta.glob('/public/assets/festival/hunt-*.webp'));
    expect(files).toHaveLength(15);
    for (const band of BANDS) {
      for (const puzzle of DEFAULT_ERROR_HUNT_PUZZLES[band]) {
        const file = assets[puzzle.imageKey].src.replace(/^.*assets\//u, '/public/assets/');
        expect(files, file).toContain(file);
      }
    }
  });

  it('대체 글과 그림 이름에 정답을 적지 않는다', () => {
    for (const band of BANDS) {
      for (const puzzle of DEFAULT_ERROR_HUNT_PUZZLES[band]) {
        const alt = assets[puzzle.imageKey].alt;
        for (const region of puzzle.regions) {
          expect(alt).not.toContain(region.label);
          expect(puzzle.title).not.toContain(region.label);
        }
      }
    }
  });
});

describe('학년이 푸는 그림 고르기', () => {
  it('학년마다 그 묶음의 그림 5장을 푼다', () => {
    expect(getErrorHuntPuzzles(config, 3)).toBe(DEFAULT_ERROR_HUNT_PUZZLES.grade3);
    expect(getErrorHuntPuzzles(config, 4)).toBe(DEFAULT_ERROR_HUNT_PUZZLES.grade4);
    expect(getErrorHuntPuzzles(config, 5)).toBe(DEFAULT_ERROR_HUNT_PUZZLES.grade56);
    expect(getErrorHuntPuzzles(config, 6)).toBe(DEFAULT_ERROR_HUNT_PUZZLES.grade56);
    expect(getErrorHuntRegions(config, 4)).toHaveLength(15);
  });

  it('미션 설정에 학년별 그림이 있으면 그 그림을 쓴다', () => {
    const own: ErrorHuntPuzzle[] = [
      {
        id: 'own-1',
        title: '우리 그림',
        imageKey: 'missionErrorHunt',
        regions: [{ id: 'own-1-a', x: 0.3, y: 0.3, r: 0.1, label: '이상한 곳' }],
      },
    ];
    const custom: ErrorHuntConfig = { ...config, gradePuzzles: { 4: own, 5: [] } };
    expect(getErrorHuntPuzzles(custom, 4)).toBe(own);
    // 빈 목록은 적지 않은 것으로 본다.
    expect(getErrorHuntPuzzles(custom, 5)).toBe(DEFAULT_ERROR_HUNT_PUZZLES.grade56);
  });

  it('학년을 모르면 공통 그림 한 장을 쓴다', () => {
    const puzzles = getErrorHuntPuzzles(config, null);
    expect(puzzles).toHaveLength(1);
    expect(puzzles[0]).toMatchObject({ imageKey: 'missionErrorHunt', regions: config.regions });
  });

  it('아직 다 찾지 못한 첫 그림부터 보여 준다', () => {
    const puzzles = DEFAULT_ERROR_HUNT_PUZZLES.grade4;
    const first = puzzles[0].regions.map((region) => region.id);
    expect(getFirstOpenPuzzleIndex(puzzles, [])).toBe(0);
    expect(getFirstOpenPuzzleIndex(puzzles, first.slice(0, 2))).toBe(0);
    expect(getFirstOpenPuzzleIndex(puzzles, first)).toBe(1);
    expect(countFoundInPuzzle(puzzles[0], [...first, 'g4-2-a'])).toBe(3);
    const all = puzzles.flatMap((puzzle) => puzzle.regions.map((region) => region.id));
    expect(getFirstOpenPuzzleIndex(puzzles, all)).toBe(4);
  });

  it('그림 밖으로 나간 정답과 겹친 ID를 알려 준다', () => {
    const puzzle = DEFAULT_ERROR_HUNT_PUZZLES.grade3[0];
    expect(getErrorHuntPuzzlesError([puzzle, puzzle])).toBe(
      '2번 그림의 정답 ID가 비었거나 겹쳐요.',
    );
    expect(getErrorHuntPuzzlesError([{ ...puzzle, regions: [] }])).toBe(
      '1번 그림에 찾을 곳이 없어요.',
    );
    expect(
      getErrorHuntPuzzlesError([
        { ...puzzle, regions: [{ id: 'far', x: 1.2, y: 0.5, r: 0.1, label: '멀리 있는 곳' }] },
      ]),
    ).toBe('1번 그림의 “멀리 있는 곳” 위치가 그림 밖이에요.');
  });
});

describe('게임 시작 전 그림 가리기', () => {
  it('기다리는 동안에는 그림을 가린다', () => {
    for (const reason of ['idle', 'not-opened', 'opened', 'upcoming'] as const) {
      expect(isErrorHuntPictureHidden('waiting', reason), reason).toBe(true);
    }
  });

  it('게임 중이거나 끝난 뒤에는 그림을 보여 준다', () => {
    for (const phase of ['active', 'submitted', 'scoring', 'closed'] as const) {
      expect(isErrorHuntPictureHidden(phase, 'opened'), phase).toBe(false);
    }
    // 시간이 끝나 더 풀 수 없는 미션
    expect(isErrorHuntPictureHidden('waiting', 'missed')).toBe(false);
  });
});

describe('틀린그림 찾기 채점', () => {
  const answer = (foundRegionIds: string[], wrongTaps = 0, remainingSeconds = 0) => ({
    type: 'error_hunt' as const,
    foundRegionIds,
    wrongTaps,
    remainingSeconds,
  });

  it('그 학년의 그림에 있는 곳만 센다', () => {
    const found = ['g4-1-a', 'g4-2-b', 'g3-1-a', 'common-1', 'g4-1-a'];
    expect(calculateAutoScore(config, answer(found), 4)).toBe(200);
    expect(calculateAutoScore(config, answer(found), 3)).toBe(100);
    expect(calculateAutoScore(config, answer(found), 6)).toBe(0);
    // 학년을 모르면 공통 그림으로 센다.
    expect(calculateAutoScore(config, answer(found, 0, 30), null)).toBe(100 + 60);
  });

  it('15곳을 모두 찾아야 남은 시간 보너스를 준다', () => {
    const all = getErrorHuntRegions(config, 5).map((region) => region.id);
    expect(calculateAutoScore(config, answer(all, 2, 100), 5)).toBe(1500 + 200 - 40);
    expect(calculateAutoScore(config, answer(all.slice(0, 14), 2, 100), 5)).toBe(1400 - 40);
  });
});

describe('정답 영역 누르기', () => {
  const aspect = 16 / 9;
  const wide = { id: 'wide', x: 0.5, y: 0.5, r: 0.2, ry: 0.1, label: '옆으로 긴 곳' };
  const circle = { id: 'circle', x: 0.2, y: 0.2, r: 0.09, label: '둥근 곳' };

  it('타원은 가로·세로 반지름 안쪽을 누르면 찾은 것이다', () => {
    expect(findHitRegion([wide], { x: 0.69, y: 0.5 }, aspect)?.id).toBe('wide');
    expect(findHitRegion([wide], { x: 0.5, y: 0.59 }, aspect)?.id).toBe('wide');
    expect(findHitRegion([wide], { x: 0.5, y: 0.61 }, aspect)).toBe(null);
    expect(findHitRegion([wide], { x: 0.71, y: 0.5 }, aspect)).toBe(null);
    // 모서리 쪽은 타원 밖이다.
    expect(findHitRegion([wide], { x: 0.66, y: 0.58 }, aspect)).toBe(null);
  });

  it('세로 반지름이 없으면 화면에서 둥근 원이다', () => {
    // 가로 반지름 0.09는 16:9 그림에서 세로로 0.16이다.
    expect(getRegionRadiusY(circle, aspect)).toBeCloseTo(0.16);
    expect(findHitRegion([circle], { x: 0.2, y: 0.35 }, aspect)?.id).toBe('circle');
    expect(findHitRegion([circle], { x: 0.2, y: 0.37 }, aspect)).toBe(null);
  });

  it('영역이 겹친 곳을 누르면 가운데가 더 가까운 영역으로 본다', () => {
    const near = { id: 'near', x: 0.6, y: 0.5, r: 0.2, ry: 0.2, label: '가까운 곳' };
    expect(findHitRegion([wide, near], { x: 0.58, y: 0.5 }, aspect)?.id).toBe('near');
    expect(findHitRegion([wide, near], { x: 0.4, y: 0.5 }, aspect)?.id).toBe('wide');
  });
});
