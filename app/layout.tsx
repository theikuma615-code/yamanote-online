import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
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
  metadataBase: new URL("https://yamanote-online.190otk.workers.dev"),
  title: {
    default: "山手線ゲームオンライン｜友達と無料で遊べるオンラインゲーム",
    template: "%s｜山手線ゲームオンライン",
  },
  description:
    "お題に沿って順番に文字で答える山手線ゲームを、友達とオンラインで楽しめる無料ゲームです。ルームを作成してURLを共有するだけで遊べます。",
  alternates: {
    canonical: "/",
  },
  icons: {
    icon: "/favicon.png",
    apple: "/favicon.png",
  },
  openGraph: {
    type: "website",
    locale: "ja_JP",
    url: "/",
    siteName: "山手線ゲームオンライン",
    title: "山手線ゲームオンライン｜友達と無料で遊べるオンラインゲーム",
    description:
      "お題に沿って順番に文字で答える山手線ゲームを、友達とオンラインで楽しめる無料ゲームです。",
    images: [
      {
        url: "/og.jpg",
        width: 1200,
        height: 630,
        alt: "山手線ゲームオンライン",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "山手線ゲームオンライン",
    description: "友達と無料で遊べる、文字入力式のオンライン山手線ゲーム。",
    images: ["/og.jpg"],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#f5f0e5",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
