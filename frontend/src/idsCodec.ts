// The label image travels as base64 of one byte per pixel (row-major, 0 = no object).

export function encodeIds(ids: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < ids.length; i += chunk) {
    binary += String.fromCharCode(...ids.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function decodeIds(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
