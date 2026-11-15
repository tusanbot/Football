import type { Metadata } from "next";
import type { ReactNode } from "react";
import Script from "next/script";
import "./globals.css";

export const metadata: Metadata = {
  title: "Football Empire | مدیریت باشگاه فوتبال",
  description: "مدیریت باشگاه، بازیکنان، مسابقات و لیگ‌ها در Football Empire.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return <html lang="fa" dir="rtl"><body>
    <Script src="https://telegram.org/js/telegram-web-app.js" strategy="beforeInteractive" />
    {children}
  </body></html>;
}
