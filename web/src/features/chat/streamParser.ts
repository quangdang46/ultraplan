function humanizeBlockType(type: string): string {
  return type
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function summarizeStructuredItem(item: Record<string, unknown>): string {
  const type = typeof item.type === "string" ? item.type : "content";
  const source =
    item.source && typeof item.source === "object"
      ? (item.source as Record<string, unknown>)
      : undefined;

  switch (type) {
    case "text":
      return typeof item.text === "string" ? item.text : "";
    case "image": {
      const mimeType =
        typeof source?.media_type === "string" ? source.media_type : undefined;
      return mimeType ? `[Image attachment: ${mimeType}]` : "[Image attachment]";
    }
    case "document": {
      const title =
        (typeof source?.filename === "string" && source.filename) ||
        (typeof item.title === "string" && item.title) ||
        (typeof item.filename === "string" && item.filename);
      return title ? `[Document: ${title}]` : "[Document attachment]";
    }
    case "search_result":
    case "web_search_result": {
      const title = typeof item.title === "string" ? item.title : "";
      const url = typeof item.url === "string" ? item.url : "";
      if (title && url) return `${title} (${url})`;
      if (title) return title;
      if (url) return url;
      return "[Search result]";
    }
    case "web_fetch_result": {
      const url = typeof item.url === "string" ? item.url : "";
      return url ? `Fetched: ${url}` : "[Fetched content]";
    }
    case "redacted_thinking":
      return "[Redacted thinking]";
    default: {
      const preview =
        (typeof item.text === "string" && item.text) ||
        (typeof item.title === "string" && item.title) ||
        (typeof item.url === "string" && item.url) ||
        (typeof item.name === "string" && item.name);
      return preview
        ? `[${humanizeBlockType(type)}: ${preview}]`
        : `[${humanizeBlockType(type)}]`;
    }
  }
}

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
        if (item && typeof item === "object") {
          return summarizeStructuredItem(item as Record<string, unknown>);
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
    return summarizeStructuredItem(raw as Record<string, unknown>);
  }

  return String(raw);
}
