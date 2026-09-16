/** 바이트를 data: 주소로 바꾼다. 교사 화면의 그림 미리보기·개별 다운로드에 쓴다. */
export function bytesToDataUrl(bytes: Uint8Array, mimeType: string): string {
  let binary = '';
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return `data:${mimeType};base64,${btoa(binary)}`;
}

/** 브라우저 다운로드를 시작한다. */
export function downloadBytes(bytes: Uint8Array, fileName: string, mimeType: string): void {
  const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: mimeType }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.rel = 'noopener';
  document.body.append(link);
  link.click();
  link.remove();
  // 다운로드가 시작될 시간을 준 뒤 정리한다.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** 글을 클립보드에 복사한다. http 주소 등으로 Clipboard API를 못 쓰면 선택 후 복사로 대신한다. */
export async function copyText(text: string, fallbackField?: HTMLTextAreaElement | null) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    if (!fallbackField) return false;
    fallbackField.focus();
    fallbackField.select();
    try {
      return document.execCommand('copy');
    } catch {
      return false;
    }
  }
}
