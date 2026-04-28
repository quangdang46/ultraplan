import { PanelLeft } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

type Props = {
  title: string;
  status?: string | null;
  lastMessageAt?: string | null;
  onOpenSidebar?: () => void;
};

function getStatusCopy(status?: string | null, lastMessageAt?: string | null): string | null {
  const normalized = status?.trim();
  const age = lastMessageAt
    ? formatDistanceToNow(new Date(lastMessageAt), { addSuffix: true })
    : null;

  if (!normalized && !age) return null;
  if (!normalized) return age;
  if (!age) return normalized;
  return `${normalized} · ${age}`;
}

export const PanelTop = ({ title, status, lastMessageAt, onOpenSidebar }: Props) => (
  <div className="flex items-center justify-between gap-2 px-[17px] py-[10px] border-b border-border-cream bg-ivory flex-shrink-0">
    <div className="flex items-center gap-2 min-w-0">
      {onOpenSidebar && (
        <button
          onClick={onOpenSidebar}
          aria-label="Open sidebar"
          className="md:hidden w-[28px] h-[28px] rounded-[7px] border border-border-warm bg-warm-sand text-charcoal-warm flex items-center justify-center"
        >
          <PanelLeft className="w-3.5 h-3.5" />
        </button>
      )}
      <h1 className="font-serif-display text-[14px] text-near-black truncate min-w-0">
        {title}
      </h1>
    </div>

    {getStatusCopy(status, lastMessageAt) && (
      <div className="text-[11px] text-stone-gray flex items-center gap-1.5 flex-shrink-0">
        <span className="w-1.5 h-1.5 rounded-full bg-[#7ec47a] flex-shrink-0" />
        {getStatusCopy(status, lastMessageAt)}
      </div>
    )}
  </div>
);
