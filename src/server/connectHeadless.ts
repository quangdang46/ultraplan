// src/server/connectHeadless.ts
// Stub for connecting headlessly to a direct connect session

import type { DirectConnectConfig } from './directConnectManager.js'

export async function runConnectHeadless(
  _config: DirectConnectConfig,
  _prompt: string,
  _outputFormat?: string,
  _interactive?: boolean,
): Promise<void> {
  // Headless mode is not implemented
  return Promise.resolve()
}
