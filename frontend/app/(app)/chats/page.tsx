import Link from "next/link";
import { Button } from "@/components/Button";
import { IconChat, IconCompose } from "@/components/icons";

/**
 * The detail pane with nothing selected. Only visible on `lg` and up — below
 * that the conversation list takes the whole screen instead.
 */
export default function ChatsPage() {
  return (
    <div className="chat-canvas flex h-full min-h-0 flex-1 flex-col items-center justify-center p-8 text-center">
      <div className="animate-fade-up flex flex-col items-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-3xl bg-surface text-brand shadow-md">
          <IconChat size={30} />
        </div>

        <h2 className="mt-5 text-lg font-semibold tracking-tight">
          Pick a conversation
        </h2>
        <p className="mt-1.5 max-w-xs text-sm leading-relaxed text-ink-2">
          Choose a chat on the left to pick up where you left off, or look
          someone up by their private number.
        </p>

        <Link href="/connect" className="mt-6">
          <Button>
            <IconCompose size={16} />
            Start a new chat
          </Button>
        </Link>
      </div>
    </div>
  );
}
