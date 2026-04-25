import { Lock, ChevronDown, MoreHorizontal, X, Square } from "lucide-react";

export const TitleBar = () => (
  <div className="flex items-center gap-[9px] bg-[#232220] border-b border-[#2e2c2a] px-[13px] py-2 select-none">
    {/* Traffic lights */}
    <div className="flex gap-1.5">
      <span className="w-3 h-3 rounded-full bg-[#ff5f57]" />
      <span className="w-3 h-3 rounded-full bg-[#ffbd2e]" />
      <span className="w-3 h-3 rounded-full bg-[#28c840]" />
    </div>

    {/* Tabs */}
    <div className="flex items-end gap-px ml-2">
      <div className="flex items-center gap-1.5 px-3 py-1 rounded-t-md text-[11.5px] text-[#6a6866]">
        <Square className="w-2.5 h-2.5" />
        New Tab
      </div>
      <div className="flex items-center gap-1.5 px-3 py-1 rounded-t-md text-[11.5px] bg-parchment text-near-black font-medium">
        <span className="w-[18px] h-[18px] rounded-[5px] bg-near-black text-ivory font-serif-display text-[11px] flex items-center justify-center">
          A
        </span>
        Claude Code
        <X className="w-2.5 h-2.5 text-[#6a6866]" />
      </div>
      <div className="text-[#5a5856] text-base px-2 cursor-pointer leading-none">+</div>
    </div>

    {/* Address */}
    <div className="flex-1 flex items-center gap-1.5 bg-[#1a1918] border border-[#303030] rounded-md px-3 py-1 text-[11px] text-[#6a6866] font-mono-claude">
      <Lock className="w-2.5 h-2.5 text-[#5a9a6a]" />
      claude.ai/code/session_011CUP6Mt5jGx8os3dceprYV
    </div>

    {/* Window actions */}
    <div className="flex items-center gap-2 text-[#525050] text-[13px]">
      <ChevronDown className="w-3.5 h-3.5 cursor-pointer hover:text-stone-gray" />
      <MoreHorizontal className="w-3.5 h-3.5 cursor-pointer hover:text-stone-gray" />
    </div>
  </div>
);
