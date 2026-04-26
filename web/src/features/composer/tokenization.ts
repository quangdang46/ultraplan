export type TriggerState = {
  trigger: '@' | '/';
  query: string;
  start: number;
  end: number;
  quoted?: boolean;
};

const AT_TOKEN_HEAD_RE = /^@[\p{L}\p{N}\p{M}_\-./\\()[\]~:]*/u;
const PATH_CHAR_HEAD_RE = /^[\p{L}\p{N}\p{M}_\-./\\()[\]~:]+/u;

export function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function extractTaggedFiles(input: string): string[] {
  const regex = /(^|\s)@(?:"([^"]+)"|([^\s]+))/g;
  const out: string[] = [];
  let match = regex.exec(input);
  while (match) {
    const value = match[2] || match[3];
    if (value) out.push(value);
    match = regex.exec(input);
  }
  return out;
}

export function extractCompletionToken(
  text: string,
  cursorPos: number,
): { token: string; startPos: number; isQuoted?: boolean } | null {
  if (!text) return null;
  const textBeforeCursor = text.substring(0, cursorPos);

  const quotedAtRegex = /@"([^"]*)"?$/;
  const quotedMatch = textBeforeCursor.match(quotedAtRegex);
  if (quotedMatch && quotedMatch.index !== undefined) {
    const textAfterCursor = text.substring(cursorPos);
    const afterQuotedMatch = textAfterCursor.match(/^[^"]*"?/);
    const quotedSuffix = afterQuotedMatch ? afterQuotedMatch[0] : '';
    return {
      token: quotedMatch[0] + quotedSuffix,
      startPos: quotedMatch.index,
      isQuoted: true,
    };
  }

  const atIdx = textBeforeCursor.lastIndexOf('@');
  if (atIdx >= 0 && (atIdx === 0 || /\s/.test(textBeforeCursor[atIdx - 1] ?? ''))) {
    const fromAt = textBeforeCursor.substring(atIdx);
    const atHeadMatch = fromAt.match(AT_TOKEN_HEAD_RE);
    if (atHeadMatch && atHeadMatch[0].length === fromAt.length) {
      const textAfterCursor = text.substring(cursorPos);
      const afterMatch = textAfterCursor.match(PATH_CHAR_HEAD_RE);
      const tokenSuffix = afterMatch ? afterMatch[0] : '';
      return {
        token: atHeadMatch[0] + tokenSuffix,
        startPos: atIdx,
        isQuoted: false,
      };
    }
  }

  const slashRegex = /(^|\s)\/([^\s/]*)$/;
  const slashMatch = textBeforeCursor.match(slashRegex);
  if (slashMatch && slashMatch.index !== undefined) {
    const tokenStart = slashMatch.index + (slashMatch[1]?.length ?? 0);
    const token = textBeforeCursor.slice(tokenStart);
    return { token, startPos: tokenStart, isQuoted: false };
  }

  return null;
}

export function parseTriggerState(value: string, cursor: number): TriggerState | null {
  const completion = extractCompletionToken(value, cursor);
  if (!completion) return null;
  const token = completion.token;
  const start = completion.startPos;
  const end = start + token.length;
  if (!token) return null;
  if (token.startsWith('/')) {
    return { trigger: '/', query: token.slice(1), start, end };
  }
  if (!token.startsWith('@')) return null;
  let body = token.slice(1);
  let quoted = false;
  if (body.startsWith('"')) {
    quoted = true;
    body = body.slice(1);
  }
  if (body.endsWith('"')) {
    body = body.slice(0, -1);
  }
  return { trigger: '@', query: body, start, end, quoted };
}

export function formatAtInsertion(text: string, keepQuoted?: boolean): string {
  const needsQuotes = keepQuoted || /\s/.test(text);
  return needsQuotes ? `@"${text}"` : `@${text}`;
}

export function longestCommonPrefix(values: string[]): string {
  if (values.length === 0) return '';
  if (values.length === 1) return values[0] ?? '';
  let prefix = values[0] ?? '';
  for (let i = 1; i < values.length; i += 1) {
    const current = values[i] ?? '';
    let j = 0;
    while (j < prefix.length && j < current.length && prefix[j] === current[j]) j += 1;
    prefix = prefix.slice(0, j);
    if (!prefix) break;
  }
  return prefix;
}
