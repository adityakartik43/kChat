import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { AuthProvider } from "@/context/AuthProvider";
import { SocketProvider } from "@/context/SocketProvider";
import { ThemeProvider } from "@/context/ThemeProvider";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Connect — chat by private number",
  description:
    "Realtime 1:1 and group chat, plus audio and video calls, with people you reach by a private number.",
};

/**
 * Resolves the stored theme before the first paint.
 *
 * Runs ahead of hydration so the tokens and the `dark:` variant are correct on
 * the very first frame — without it the page renders light for a beat whenever
 * the preference is dark.
 */
const THEME_SCRIPT = `(function(){try{var s=localStorage.getItem("connect.theme");var t=(s==="light"||s==="dark")?s:(window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light");document.documentElement.dataset.theme=t;}catch(e){document.documentElement.dataset.theme="light";}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      data-theme="light"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="h-full">
        <ThemeProvider>
          <AuthProvider>
            <SocketProvider>{children}</SocketProvider>
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
