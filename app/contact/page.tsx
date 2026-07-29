import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "お問い合わせ・運営者情報",
  description: "山手線ゲームオンラインへのお問い合わせ方法と運営情報です。",
};

export default function ContactPage() {
  return (
    <main className="legal-page">
      <Link className="legal-back" href="/">← ゲームへ戻る</Link>
      <article>
        <span>CONTACT</span>
        <h1>お問い合わせ</h1>
        <p>山手線ゲームオンラインは個人運営の無料Webゲームです。</p>
        <h2>不具合・ご要望</h2>
        <p>
          公開リポジトリの
          <a href="https://github.com/theikuma615-code/yamanote-online/issues" target="_blank" rel="noreferrer">
            GitHub Issues
          </a>
          からご連絡ください。ルームコード、ニックネーム、個人情報、秘密情報は投稿しないでください。
        </p>
        <h2>運営表記</h2>
        <p>運営：山手線ゲームオンライン運営<br />提供形態：無料・広告なし（2026年7月時点）</p>
      </article>
    </main>
  );
}
