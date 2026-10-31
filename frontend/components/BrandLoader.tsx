import { IconLogo } from "./icons";

/**
 * The brand's loading state.
 *
 * `full` is for whole-page waits (auth restore, first paint); inside a panel
 * the loader fills the panel instead so the surrounding chrome stays put.
 */
export function BrandLoader({
  message,
  full = false,
}: {
  message?: string;
  full?: boolean;
}) {
  return (
    <div
      className={`flex w-full flex-col items-center justify-center gap-5 bg-canvas p-8 ${
        full ? "min-h-screen" : "h-full min-h-48"
      }`}
    >
      <div className="flex items-center gap-2.5 animate-fade-in">
        <IconLogo size={34} />
        <span className="text-xl font-semibold tracking-tight">Connect</span>
      </div>

      <div className="h-1 w-36 overflow-hidden rounded-full bg-muted">
        <div className="h-full w-1/3 animate-[shimmer_1.2s_ease-in-out_infinite] rounded-full bg-[image:var(--gradient-brand)]" />
      </div>

      {message && <p className="text-sm text-ink-3">{message}</p>}
    </div>
  );
}
