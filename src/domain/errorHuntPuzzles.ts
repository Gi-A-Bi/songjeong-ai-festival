import type { ErrorHuntBand, ErrorHuntPuzzle } from './types';

/*
 * ‘AI 틀린그림 찾기’의 학년 묶음별 그림 5장과 이상한 곳 3군데.
 * 그림은 교사가 생성형 AI로 만들었다(출처: docs/ARTWORK_CREDITS.md).
 * 좌표는 그림 너비·높이에 대한 0~1 비율이고, r은 가로 반지름, ry는 세로 반지름이다.
 * 그림을 바꾸면 파일 이름도 바꾼다(기기에 남은 예전 그림이 보이지 않게).
 */
export const DEFAULT_ERROR_HUNT_PUZZLES: Record<ErrorHuntBand, readonly ErrorHuntPuzzle[]> = {
  grade3: [
    {
      id: 'g3-1',
      title: '교실',
      imageKey: 'huntG3_1',
      regions: [
        { id: 'g3-1-a', x: 0.195, y: 0.64, r: 0.085, ry: 0.115, label: '어항 속의 새' },
        { id: 'g3-1-b', x: 0.475, y: 0.4, r: 0.08, ry: 0.155, label: '네모난 지구본' },
        { id: 'g3-1-c', x: 0.855, y: 0.205, r: 0.125, ry: 0.125, label: '하늘에 뜬 고래' },
      ],
    },
    {
      id: 'g3-2',
      title: '운동장',
      imageKey: 'huntG3_2',
      regions: [
        { id: 'g3-2-a', x: 0.17, y: 0.22, r: 0.165, ry: 0.18, label: '나무에 열린 축구공' },
        { id: 'g3-2-b', x: 0.515, y: 0.27, r: 0.075, ry: 0.125, label: '세모난 농구 골대' },
        { id: 'g3-2-c', x: 0.825, y: 0.52, r: 0.14, ry: 0.22, label: '줄 없이 떠 있는 그네' },
      ],
    },
    {
      id: 'g3-3',
      title: '부엌',
      imageKey: 'huntG3_3',
      regions: [
        { id: 'g3-3-a', x: 0.13, y: 0.395, r: 0.055, ry: 0.1, label: '냉장고 속 펭귄' },
        { id: 'g3-3-b', x: 0.538, y: 0.66, r: 0.05, ry: 0.13, label: '위로 흐르는 주스' },
        {
          id: 'g3-3-c',
          x: 0.87,
          y: 0.385,
          r: 0.085,
          ry: 0.175,
          label: '화분에서 자라는 숟가락과 포크',
        },
      ],
    },
    {
      id: 'g3-4',
      title: '공원',
      imageKey: 'huntG3_4',
      regions: [
        { id: 'g3-4-a', x: 0.244, y: 0.213, r: 0.05, ry: 0.085, label: '네모난 해' },
        { id: 'g3-4-b', x: 0.56, y: 0.67, r: 0.1, ry: 0.125, label: '도넛 바퀴 자전거' },
        { id: 'g3-4-c', x: 0.808, y: 0.285, r: 0.05, ry: 0.085, label: '딸기 가로등' },
      ],
    },
    {
      id: 'g3-5',
      title: '바닷가',
      imageKey: 'huntG3_5',
      regions: [
        { id: 'g3-5-a', x: 0.13, y: 0.52, r: 0.095, ry: 0.2, label: '여름 바닷가의 눈사람' },
        { id: 'g3-5-b', x: 0.435, y: 0.355, r: 0.07, ry: 0.13, label: '나뭇잎 돛' },
        { id: 'g3-5-c', x: 0.88, y: 0.14, r: 0.095, ry: 0.125, label: '야자나무에 열린 수박' },
      ],
    },
  ],
  grade4: [
    {
      id: 'g4-1',
      title: '도서관',
      imageKey: 'huntG4_1',
      regions: [
        { id: 'g4-1-a', x: 0.2, y: 0.19, r: 0.09, ry: 0.09, label: '책장에 꽂힌 식빵' },
        { id: 'g4-1-b', x: 0.505, y: 0.485, r: 0.09, ry: 0.095, label: '고양이 모양 그림자' },
        { id: 'g4-1-c', x: 0.91, y: 0.82, r: 0.05, ry: 0.125, label: '당근 의자 다리' },
      ],
    },
    {
      id: 'g4-2',
      title: '과학실',
      imageKey: 'huntG4_2',
      regions: [
        { id: 'g4-2-a', x: 0.16, y: 0.56, r: 0.125, ry: 0.23, label: '기울어진 물' },
        { id: 'g4-2-b', x: 0.54, y: 0.63, r: 0.1, ry: 0.215, label: '자석에 붙은 연필과 지우개' },
        { id: 'g4-2-c', x: 0.87, y: 0.34, r: 0.095, ry: 0.235, label: '거꾸로 심긴 식물' },
      ],
    },
    {
      id: 'g4-3',
      title: '동네 거리',
      imageKey: 'huntG4_3',
      regions: [
        { id: 'g4-3-a', x: 0.472, y: 0.56, r: 0.055, ry: 0.075, label: '뒷바퀴 없는 버스' },
        { id: 'g4-3-b', x: 0.49, y: 0.735, r: 0.11, ry: 0.115, label: '다리가 여섯 개인 강아지' },
        { id: 'g4-3-c', x: 0.837, y: 0.21, r: 0.05, ry: 0.12, label: '계단 없는 2층 문' },
      ],
    },
    {
      id: 'g4-4',
      title: '농장',
      imageKey: 'huntG4_4',
      regions: [
        { id: 'g4-4-a', x: 0.233, y: 0.82, r: 0.085, ry: 0.085, label: '네모난 달걀' },
        { id: 'g4-4-b', x: 0.417, y: 0.095, r: 0.055, ry: 0.1, label: '위로 올라가는 빗방울' },
        { id: 'g4-4-c', x: 0.825, y: 0.22, r: 0.145, ry: 0.22, label: '나무에 열린 당근' },
      ],
    },
    {
      id: 'g4-5',
      title: '캠핑장',
      imageKey: 'huntG4_5',
      regions: [
        { id: 'g4-5-a', x: 0.175, y: 0.675, r: 0.095, ry: 0.085, label: '집 모양 텐트 그림자' },
        { id: 'g4-5-b', x: 0.4, y: 0.56, r: 0.12, ry: 0.2, label: '얼음에서 타는 불' },
        { id: 'g4-5-c', x: 0.69, y: 0.68, r: 0.19, ry: 0.22, label: '구불구불한 불빛' },
      ],
    },
  ],
  grade56: [
    {
      id: 'g56-1',
      title: '미술실',
      imageKey: 'huntG56_1',
      regions: [
        { id: 'g56-1-a', x: 0.185, y: 0.4, r: 0.15, ry: 0.27, label: '거울 속 옷 색이 다름' },
        { id: 'g56-1-b', x: 0.42, y: 0.32, r: 0.07, ry: 0.13, label: '손가락이 6개' },
        { id: 'g56-1-c', x: 0.83, y: 0.78, r: 0.125, ry: 0.1, label: '붓 끝이 포크' },
      ],
    },
    {
      id: 'g56-2',
      title: '음악실',
      imageKey: 'huntG56_2',
      regions: [
        { id: 'g56-2-a', x: 0.19, y: 0.39, r: 0.165, ry: 0.13, label: '검은 건반이 없는 피아노' },
        { id: 'g56-2-b', x: 0.565, y: 0.8, r: 0.12, ry: 0.17, label: '자세가 다른 그림자' },
        { id: 'g56-2-c', x: 0.842, y: 0.43, r: 0.145, ry: 0.12, label: '양쪽이 나팔인 트럼펫' },
      ],
    },
    {
      id: 'g56-3',
      title: '비 갠 거리',
      imageKey: 'huntG56_3',
      regions: [
        { id: 'g56-3-a', x: 0.205, y: 0.79, r: 0.11, ry: 0.1, label: '물에 비친 지붕이 다름' },
        {
          id: 'g56-3-b',
          x: 0.522,
          y: 0.455,
          r: 0.165,
          ry: 0.11,
          label: '바퀴가 세 개 보이는 승용차',
        },
        { id: 'g56-3-c', x: 0.84, y: 0.3, r: 0.105, ry: 0.16, label: '벽에서 끝나는 계단' },
      ],
    },
    {
      id: 'g56-4',
      title: '체육관',
      imageKey: 'huntG56_4',
      regions: [
        { id: 'g56-4-a', x: 0.217, y: 0.435, r: 0.06, ry: 0.08, label: '끊어졌는데 팽팽한 줄' },
        { id: 'g56-4-b', x: 0.37, y: 0.7, r: 0.09, ry: 0.11, label: '방향이 다른 그림자' },
        { id: 'g56-4-c', x: 0.875, y: 0.31, r: 0.12, ry: 0.17, label: '기둥이 하나뿐인 네트' },
      ],
    },
    {
      id: 'g56-5',
      title: '거실',
      imageKey: 'huntG56_5',
      regions: [
        { id: 'g56-5-a', x: 0.17, y: 0.55, r: 0.14, ry: 0.2, label: '꼬리가 두 개인 고양이' },
        { id: 'g56-5-b', x: 0.485, y: 0.285, r: 0.225, ry: 0.225, label: '창문마다 다른 계절' },
        { id: 'g56-5-c', x: 0.91, y: 0.21, r: 0.09, ry: 0.14, label: '액자 밖으로 나온 꼬리' },
      ],
    },
  ],
};
