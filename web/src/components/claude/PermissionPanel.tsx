import { Check, ShieldAlert, X } from 'lucide-react';
import type { PendingPermission } from '../../features/chat/types';

type Props = {
  requests: PendingPermission[];
  onRespond: (requestId: string, approved: boolean) => void | Promise<void>;
};

function summarizeInput(input: Record<string, unknown>): string | null {
  const serialized = JSON.stringify(input);
  if (!serialized || serialized === '{}') return null;
  return serialized.length > 120 ? `${serialized.slice(0, 120)}...` : serialized;
}

export function PermissionPanel({ requests, onRespond }: Props) {
  if (requests.length === 0) return null;

  return (
    <div className="space-y-3">
      {requests.map((request) => {
        const inputSummary = summarizeInput(request.toolInput);
        return (
          <div
            key={request.requestId}
            className="rounded-xl border border-[#efcfad] bg-[#fff8ee] px-4 py-3 text-near-black"
          >
            <div className="flex items-start gap-3">
              <span className="mt-0.5 inline-flex h-8 w-8 items-center justify-center rounded-lg bg-[#f6e3c7] text-[#a15a1d]">
                <ShieldAlert className="h-4 w-4" />
              </span>

              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-[#8f4f1a]">
                  Permission required
                </div>
                <div className="mt-1 text-sm font-medium">
                  {request.toolName}
                </div>
                {request.description && (
                  <div className="mt-1 text-xs leading-5 text-charcoal-warm">
                    {request.description}
                  </div>
                )}
                {inputSummary && (
                  <pre className="mt-2 overflow-x-auto rounded-lg bg-white/80 px-3 py-2 text-[11px] leading-5 text-charcoal-warm">
                    {inputSummary}
                  </pre>
                )}
              </div>

              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  onClick={() => void onRespond(request.requestId, true)}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-terracotta px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-[#c86a4b]"
                >
                  <Check className="h-3.5 w-3.5" />
                  Allow
                </button>
                <button
                  type="button"
                  onClick={() => void onRespond(request.requestId, false)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-[#dfc29d] bg-white px-3 py-2 text-xs font-medium text-charcoal-warm transition-colors hover:bg-[#fbf2e4]"
                >
                  <X className="h-3.5 w-3.5" />
                  Deny
                </button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
