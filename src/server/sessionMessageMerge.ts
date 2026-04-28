import type { SessionMessage } from '../../packages/contracts/src/index.js'

function cloneMessage(message: SessionMessage): SessionMessage {
  return {
    ...message,
    ...(message.blocks ? { blocks: [...message.blocks] } : {}),
    ...(message.quote ? { quote: { ...message.quote } } : {}),
  }
}

function chooseLongerText(
  transcriptContent: string,
  inMemoryContent: string,
): string {
  return inMemoryContent.trim().length > transcriptContent.trim().length
    ? inMemoryContent
    : transcriptContent
}

function chooseRicherBlocks(
  transcriptBlocks: SessionMessage['blocks'],
  inMemoryBlocks: SessionMessage['blocks'],
): SessionMessage['blocks'] {
  const transcriptCount = transcriptBlocks?.length ?? 0
  const inMemoryCount = inMemoryBlocks?.length ?? 0
  if (transcriptCount >= inMemoryCount) {
    return transcriptBlocks ? [...transcriptBlocks] : undefined
  }
  return inMemoryBlocks ? [...inMemoryBlocks] : undefined
}

function mergeSessionMessage(
  transcriptMessage: SessionMessage,
  inMemoryMessage: SessionMessage,
): SessionMessage {
  if (transcriptMessage.role !== inMemoryMessage.role) {
    return cloneMessage(transcriptMessage)
  }

  return {
    role: transcriptMessage.role,
    content: chooseLongerText(
      transcriptMessage.content,
      inMemoryMessage.content,
    ),
    timestamp:
      inMemoryMessage.timestamp > transcriptMessage.timestamp
        ? inMemoryMessage.timestamp
        : transcriptMessage.timestamp,
    ...(chooseRicherBlocks(
      transcriptMessage.blocks,
      inMemoryMessage.blocks,
    )
      ? {
          blocks: chooseRicherBlocks(
            transcriptMessage.blocks,
            inMemoryMessage.blocks,
          ),
        }
      : {}),
    ...(transcriptMessage.quote ?? inMemoryMessage.quote
      ? { quote: transcriptMessage.quote ?? inMemoryMessage.quote }
      : {}),
  }
}

export function mergeSessionMessages(
  transcriptMessages: SessionMessage[],
  inMemoryMessages: SessionMessage[],
): SessionMessage[] {
  if (transcriptMessages.length === 0) {
    return inMemoryMessages.map(cloneMessage)
  }

  const merged = transcriptMessages.map(cloneMessage)

  for (let index = 0; index < inMemoryMessages.length; index += 1) {
    const inMemoryMessage = inMemoryMessages[index]
    if (!inMemoryMessage) continue

    const transcriptMessage = merged[index]
    if (!transcriptMessage) {
      merged.push(cloneMessage(inMemoryMessage))
      continue
    }

    if (transcriptMessage.role !== inMemoryMessage.role) {
      continue
    }

    merged[index] = mergeSessionMessage(transcriptMessage, inMemoryMessage)
  }

  return merged
}
