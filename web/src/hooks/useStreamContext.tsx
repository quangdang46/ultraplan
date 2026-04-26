import { createContext, useContext, type ReactNode } from 'react';
import { useStream } from '../hooks/useStream';

interface StreamContextValue {
  messages: ReturnType<typeof useStream>['messages'];
  isStreaming: ReturnType<typeof useStream>['isStreaming'];
  error: ReturnType<typeof useStream>['error'];
  sendMessage: ReturnType<typeof useStream>['sendMessage'];
  executeSlashCommand: ReturnType<typeof useStream>['executeSlashCommand'];
  cancelStream: ReturnType<typeof useStream>['cancelStream'];
  clearMessages: ReturnType<typeof useStream>['clearMessages'];
}

const StreamContext = createContext<StreamContextValue | null>(null);

export function StreamProvider({ children }: { children: ReactNode }) {
  const stream = useStream();
  return (
    <StreamContext.Provider value={stream}>
      {children}
    </StreamContext.Provider>
  );
}

export function useStreamContext() {
  const ctx = useContext(StreamContext);
  if (!ctx) throw new Error('useStreamContext must be used within StreamProvider');
  return ctx;
}
