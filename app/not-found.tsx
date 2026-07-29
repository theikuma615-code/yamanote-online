import Link from "next/link";

export default function NotFound() {
  return (
    <main className="not-found-page">
      <span>404 / WRONG STATION</span>
      <div className="brand-mark">山</div>
      <h1>このページには<br />停まりません。</h1>
      <p>URLを確認するか、トップページからゲームを始めてください。</p>
      <Link href="/">ゲームへ戻る →</Link>
    </main>
  );
}
