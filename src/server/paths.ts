export function reverseProjectDirName(dirName: string): string | null {
  const m = dirName.match(/^([A-Za-z])--(.+)$/);
  if (!m) return null;
  const drive = m[1].toUpperCase();
  const rest = m[2].replace(/-/g, '/');
  return `${drive}:/${rest}`;
}

export function encodeProjectDir(p: string): string {
  return Buffer.from(p, 'utf8').toString('base64url');
}

export function decodeProjectDir(b64: string): string {
  return Buffer.from(b64, 'base64url').toString('utf8');
}
