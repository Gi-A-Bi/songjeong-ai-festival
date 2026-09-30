import { describe, expect, it } from 'vitest';
import {
  classroomName,
  formatMissionRoom,
  getMissionInfoError,
  missionRoom,
  normalizeMissionInfo,
} from './missionRoom';

describe('미션 교실 이름', () => {
  it('학년 자리표시를 학년으로 바꾸고, 학년을 모르면 각 학년으로 보여 준다', () => {
    expect(classroomName(1)).toBe('{학년} 1반 교실');
    expect(formatMissionRoom('{학년} 1반 교실', 4)).toBe('4학년 1반 교실');
    expect(formatMissionRoom('{학년} 1반 교실', null)).toBe('각 학년 1반 교실');
    expect(missionRoom({ room: '도서관' }, 3)).toBe('도서관');
  });

  it('미션 이름과 교실을 검사하고 다듬는다', () => {
    expect(
      getMissionInfoError({ title: 'AI 골든벨', room: '{학년} 1반 교실', summary: '' }),
    ).toBeNull();
    expect(getMissionInfoError({ title: ' ', room: '도서관', summary: '' })).toMatch(/미션 이름/);
    expect(getMissionInfoError({ title: '골든벨', room: '', summary: '' })).toMatch(/교실 이름/);
    expect(
      getMissionInfoError({ title: '골든벨', room: '도서관', summary: 'a'.repeat(81) }),
    ).toMatch(/한 줄 소개/);
    expect(
      normalizeMissionInfo({ title: ' 골든벨 ', room: ' 도서관 ', summary: ' 소개 ' }),
    ).toEqual({
      title: '골든벨',
      room: '도서관',
      summary: '소개',
    });
  });
});
