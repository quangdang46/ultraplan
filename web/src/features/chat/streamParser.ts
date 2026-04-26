export function toToolResultText(raw: unknown): string {
  if (typeof raw === 'string') return raw;
  if (!raw) return '';

  if (Array.isArray(raw)) {
    return raw
      .map((item) => {
        if (typeof item === 'string') return item;
        if (
          item &&
          typeof item === 'object' &&
          'text' in item &&
          typeof (item as { text?: unknown }).text === 'string'
        ) {
          return (item as { text: string }).text;
        }
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }

  if (typeof raw === 'object') {
    const maybeContent = raw as { content?: unknown; text?: unknown };
    if (typeof maybeContent.text === 'string') return maybeContent.text;
    if (maybeContent.content !== undefined) {
      return toToolResultText(maybeContent.content);
    }
  }

  return String(raw);
}
