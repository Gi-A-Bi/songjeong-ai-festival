/**
 * 기기 번호: 익명 세션 ID의 끝 네 글자. 이름이나 계정 정보가 아니라
 * "어느 디벗인지"만 교사와 학생이 서로 확인하는 용도다.
 */
export function toDeviceCode(deviceId: string): string {
  const cleaned = deviceId.replace(/[^0-9a-zA-Z]/g, '');
  return cleaned.slice(-4).toUpperCase().padStart(4, '0');
}
