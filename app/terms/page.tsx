import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "利用規約",
  description: "山手線ゲームオンラインの利用規約です。",
};

export default function TermsPage() {
  return (
    <main className="legal-page">
      <Link className="legal-back" href="/">← ゲームへ戻る</Link>
      <article>
        <span>TERMS OF SERVICE</span>
        <h1>利用規約</h1>
        <p>最終更新日：2026年7月29日</p>
        <h2>1. サービスについて</h2>
        <p>山手線ゲームオンライン（以下「本サービス」）は、複数人でお題に沿った回答を入力して遊ぶ無料のWebゲームです。</p>
        <h2>2. 禁止事項</h2>
        <p>他の利用者への嫌がらせ、不適切な名前や回答の投稿、過度な連続アクセス、サービスの妨害、不正アクセスを禁止します。</p>
        <h2>3. 回答の判定</h2>
        <p>登録済み回答があるお題は自動判定します。自由回答は意味の正しさを完全には自動判定できないため、必要に応じて参加者同士で確認してください。</p>
        <h2>4. 免責</h2>
        <p>通信障害、ブラウザの制限、保守その他の事情により、本サービスを一時停止または変更する場合があります。本サービスの利用によって生じた損害について、運営者は法令上認められる範囲で責任を負いません。</p>
        <h2>5. 規約の変更</h2>
        <p>必要に応じて本規約を変更することがあります。重要な変更は本ページでお知らせします。</p>
      </article>
    </main>
  );
}
