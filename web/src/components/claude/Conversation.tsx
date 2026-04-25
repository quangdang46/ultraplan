export const Conversation = () => (
  <article className="font-sans text-[14px] leading-[1.72] text-olive-gray">
    {/* Warning */}
    <div className="bg-[hsl(var(--warn-bg))] border border-[hsl(var(--warn-border))] rounded-[9px] px-3.5 py-[11px] mb-3.5 text-charcoal-warm leading-[1.6]">
      <Strong>Unfortunately, native Cloudflare caching CANNOT bypass Workers</Strong>
      {" "}— Workers always execute before cache, so every request is billed even when cached.
    </div>

    <SecHd>💡 Solution: Railway + Cloudflare CDN</SecHd>
    <p className="mb-3"><Strong>Move logic to Railway, use Cloudflare's FREE CDN caching in front:</Strong></p>
    <ul className="space-y-1 mb-3 pl-1">
      <Bullet>Current: 600M requests × Workers billing = <Strong>$180+/month</Strong></Bullet>
      <Bullet>New: 95% cached by CDN (free) + Railway = <Strong>$5-10/month</Strong></Bullet>
      <Bullet>Savings: <Strong>~$170/month ($2,040/year)</Strong></Bullet>
    </ul>

    <SecHd>📦 What I Created</SecHd>
    <p className="mb-3">Complete migration package in <Code>railway/</Code> directory:</p>
    <ul className="space-y-1 mb-3 pl-1">
      <Bullet><Strong>server.ts</Strong> — Bun server (ported from your Worker)</Bullet>
      <Bullet><Strong>QUICKSTART.md</Strong> — Deploy in 10 minutes</Bullet>
      <Bullet><Strong>MIGRATION_GUIDE.md</Strong> — Detailed step-by-step with rollback strategies</Bullet>
      <Bullet><Strong>COMPARISON.md</Strong> — Workers vs Railway analysis</Bullet>
      <Bullet><Strong>test.sh</Strong> — Automated testing script</Bullet>
    </ul>

    <SecHd>🛡️ Safe Migration Strategy</SecHd>
    <ol className="space-y-1.5 mb-3">
      <Numbered n={1}>Deploy to Railway (Worker stays live)</Numbered>
      <Numbered n={2}>Test Railway directly (no traffic yet)</Numbered>
      <Numbered n={3}>Switch DNS to Railway with Cloudflare CDN</Numbered>
      <Numbered n={4}><Strong>Instant rollback</Strong>: Just change DNS back (~5 min)</Numbered>
      <Numbered n={5}>Monitor 48h, delete Worker if stable</Numbered>
    </ol>

    <p className="mt-3 text-stone-gray text-[13px] italic">
      Ready to start with the QUICKSTART.md guide, or have questions about the approach?
    </p>
  </article>
);

const SecHd = ({ children }: { children: React.ReactNode }) => (
  <h2 className="text-[14.5px] font-semibold text-near-black mt-4 mb-1.5">{children}</h2>
);

const Strong = ({ children }: { children: React.ReactNode }) => (
  <strong className="text-near-black font-semibold">{children}</strong>
);

const Bullet = ({ children }: { children: React.ReactNode }) => (
  <li className="pl-[15px] relative">
    <span className="absolute left-[3px] text-stone-gray">•</span>
    {children}
  </li>
);

const Numbered = ({ n, children }: { n: number; children: React.ReactNode }) => (
  <li className="pl-[19px] relative">
    <span className="absolute left-0 top-px text-stone-gray text-xs font-medium">{n}.</span>
    {children}
  </li>
);

const Code = ({ children }: { children: React.ReactNode }) => (
  <span className="bg-warm-sand text-dark-surface font-mono-claude text-[11.5px] px-[5px] py-px rounded border border-border-warm">
    {children}
  </span>
);
