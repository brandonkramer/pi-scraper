export function decodeText(buffer: Buffer, contentType: string | undefined): string {
  const charset = contentType?.match(/charset=([^;]+)/iu)?.[1]?.trim().toLowerCase().replace(/_/gu, "-");
  if (charset === "ascii") {
    return buffer.toString("ascii");
  }
  if (charset === "latin1" || charset === "latin-1" || charset === "iso-8859-1") {
    return buffer.toString("latin1");
  }
  if (charset === "windows-1252" || charset === "cp1252") {
    return decodeWindows1252(buffer);
  }
  return buffer.toString("utf8");
}

const WINDOWS_1252_CONTROLS: Record<number, string> = {
  0x80: "€", 0x82: "‚", 0x83: "ƒ", 0x84: "„", 0x85: "…", 0x86: "†", 0x87: "‡", 0x88: "ˆ",
  0x89: "‰", 0x8a: "Š", 0x8b: "‹", 0x8c: "Œ", 0x8e: "Ž", 0x91: "‘", 0x92: "’", 0x93: "“",
  0x94: "”", 0x95: "•", 0x96: "–", 0x97: "—", 0x98: "˜", 0x99: "™", 0x9a: "š", 0x9b: "›",
  0x9c: "œ", 0x9e: "ž", 0x9f: "Ÿ",
};

function decodeWindows1252(buffer: Buffer): string {
  let text = "";
  for (const byte of buffer) {
    text += WINDOWS_1252_CONTROLS[byte] ?? String.fromCodePoint(byte);
  }
  return text;
}
