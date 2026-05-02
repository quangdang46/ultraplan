import { cn } from "@/lib/utils";

type TextShimmerProps = {
  children: string;
  className?: string;
};

export function TextShimmer({ children, className }: TextShimmerProps) {
  return (
    <span
      className={cn("inline-block animate-pulse text-stone-gray", className)}
    >
      {children}
    </span>
  );
}
