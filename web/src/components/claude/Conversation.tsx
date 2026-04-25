import { useState } from "react";
import { tools } from "./conversation.data";
import { ConversationToolItem } from "./ConversationToolItem";

export const Conversation = () => {
  const [openId, setOpenId] = useState<string>("read-conversation");

  return (
    <article className="font-sans text-[14px] leading-[1.72] text-olive-gray">
      <p className="mb-2 text-near-black">
        Mock conversation with diverse tool calls and output styles:
      </p>

      <div className="space-y-2.5">
        {tools.map((tool) => {
          const isOpen = openId === tool.id;

          return (
            <ConversationToolItem
              key={tool.id}
              tool={tool}
              isOpen={isOpen}
              onToggle={() => setOpenId(isOpen ? "" : tool.id)}
            />
          );
        })}
      </div>

      <div className="mt-5 rounded-[12px] border border-border-warm bg-white/70 p-3.5 shadow-whisper backdrop-blur-[1px]">
        <p className="text-near-black">
          This mockup now includes success, running, and failed tool states.
        </p>
        <p className="mt-1 text-charcoal-warm">
          If this direction looks good, I can map these rows to your real stream events from backend.
        </p>
      </div>
    </article>
  );
};
