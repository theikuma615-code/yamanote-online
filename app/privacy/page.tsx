import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "プライバシーポリシー",
  description: "山手線ゲームオンラインのプライバシーポリシーです。",
};

export default function PrivacyPage() {
  return (
    <main className="legal-page">
      <Link className="legal-back" href="/">← ゲームへ戻る</Link>
      <article>
        <span>PRIVACY POLICY</span>
        <h1>プライバシーポリシー</h1>
        <p>最終更新日：2026年7月29日</p>
        <h2>収集する情報</h2>
        <p>ゲームの進行に必要なニックネーム、回答、ルーム情報、匿名のプレイヤー識別子を一時的に保存します。アカウント登録、メールアドレス、電話番号の入力は求めません。</p>
        <h2>利用目的</h2>
        <p>ルームへの参加、回答判定、順位表示、再接続、荒らしや過度な連続送信の防止に利用します。</p>
        <h2>端末内の保存</h2>
        <p>再接続情報と効果音設定をlocalStorageへ保存します。ブラウザの設定から削除できます。</p>
        <h2>第三者提供</h2>
        <p>法令に基づく場合を除き、保存した情報を第三者へ販売または提供しません。</p>
        <h2>保存期間</h2>
        <p>ゲームデータは運営・保守に必要な期間保存し、不要になったデータは順次削除します。</p>
      </article>
    </main>
  );
}
