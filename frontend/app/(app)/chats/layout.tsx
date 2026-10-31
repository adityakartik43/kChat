"use client";

import { usePathname } from "next/navigation";
import { ConversationList } from "@/components/ConversationList";

/**
 * Two-pane chats: the conversation panel stays mounted while the detail pane
 * swaps, so scroll position, search text and badges survive opening a chat.
 *
 * Below `lg` it collapses to one pane at a time — the list, or the
 * conversation — with the chat header's back button as the way home.
 */
export default function ChatsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const chatOpen = /^\/chats\/[^/]+/.test(pathname);

  return (
    <div className="flex min-h-0 flex-1">
      <aside
        className={`${chatOpen ? "hidden lg:flex" : "flex"} min-h-0 w-full shrink-0 lg:w-[336px] xl:w-[368px]`}
      >
        <ConversationList />
      </aside>

      <section
        className={`${chatOpen ? "flex" : "hidden lg:flex"} min-h-0 min-w-0 flex-1 flex-col`}
      >
        {children}
      </section>
    </div>
  );
}
