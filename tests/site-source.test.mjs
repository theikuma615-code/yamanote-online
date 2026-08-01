import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("includes the core onboarding and invitation experience", async () => {
  const app = await readFile(new URL("app/game-app.tsx", root), "utf8");
  const route = await readFile(new URL("app/api/game/route.ts", root), "utf8");
  assert.match(app, /文字で回答/);
  assert.match(app, /登録済み回答があるお題は自動判定/);
  assert.match(app, /友達ルームをつくる/);
  assert.match(app, /main-mode-actions/);
  assert.match(app, /ルームコードで参加/);
  assert.doesNotMatch(app, /inline-join/);
  assert.doesNotMatch(app, /おすすめ/);
  assert.doesNotMatch(app, /ticket-cut/);
  assert.match(app, /プレイヤー名を入力してください/);
  assert.match(app, /data\.room\.status === "finished"[\s\S]*clearSession\(\)/);
  assert.match(app, /flowVersionRef/);
  assert.match(app, /招待URLをコピー/);
  assert.match(app, /navigator\.share/);
  assert.doesNotMatch(app, /line\.me\/R\/msg\/text/);
  assert.doesNotMatch(app, /import\("qrcode"\)/);
  assert.doesNotMatch(app, /LINEで送る/);
  assert.doesNotMatch(app, /QRコード/);
  assert.match(app, /randomMatchTimeLimit = 15/);
  assert.match(app, /詳細設定/);
  assert.doesNotMatch(app, /今後実装します/);
  assert.doesNotMatch(app, /time-pick/);
  assert.match(app, /開始するお題/);
  assert.match(app, /誰かが間違えるごと/);
  assert.match(app, /ライフの数/);
  assert.match(app, /\{\[2, 3, 5\]\.map\(\(value\) => \(/);
  assert.match(app, /爆弾モード/);
  assert.match(app, /30秒で別のお題に切り替える/);
  assert.match(route, /randomMatchTimeLimit = 15/);
  assert.match(route, /action === "update_settings"/);
  assert.match(route, /topic_switch_mode/);
  assert.match(route, /life_enabled/);
  assert.match(route, /bomb_duration/);
  assert.match(route, /bomb_topic_switch_enabled/);
  assert.match(route, /now - room\.turn_started_at >= 30_000/);
  assert.match(route, /deadline - now <= 5_000/);
  assert.match(app, /bombTopicSwitchEnabled/);
  assert.match(app, /お題切り替え OFF/);
  assert.match(app, /受け取った人には5秒の回答時間が保証/);
  assert.match(app, /body\.action !== "update_settings"[\s\S]*setScreen\("room"\)/);
  assert.match(app, /接続が切れました。再接続しています/);
  assert.match(app, /\/logo-mark\.png/);
  assert.doesNotMatch(app, /quick-guide/);
  assert.doesNotMatch(app, /山手線ゲームオンライン • 山手線ゲームオンライン/);
  assert.doesNotMatch(app, /dangerouslySetInnerHTML/);
});

test("includes public-site metadata and required routes", async () => {
  const layout = await readFile(new URL("app/layout.tsx", root), "utf8");
  assert.match(layout, /metadataBase/);
  assert.match(layout, /openGraph/);
  assert.match(layout, /summary_large_image/);
  assert.match(layout, /canonical/);
  await Promise.all([
    access(new URL("public/og.jpg", root)),
    access(new URL("public/favicon.png", root)),
    access(new URL("public/logo-mark.png", root)),
    access(new URL("public/robots.txt", root)),
    access(new URL("public/sitemap.xml", root)),
    access(new URL("app/terms/page.tsx", root)),
    access(new URL("app/privacy/page.tsx", root)),
    access(new URL("app/contact/page.tsx", root)),
    access(new URL("app/not-found.tsx", root)),
  ]);
});

test("keeps mobile and reduced-motion protections", async () => {
  const app = await readFile(new URL("app/game-app.tsx", root), "utf8");
  const css = await readFile(new URL("app/globals.css", root), "utf8");
  assert.match(app, /`screen-\$\{screen\}`/);
  assert.match(app, /`room-\$\{game\.room\.status\}`/);
  assert.match(app, /lobby-start-action/);
  assert.match(app, /home-intro/);
  assert.match(app, /home-learning/);
  assert.match(app, /mobile-section-title">遊び方/);
  assert.match(app, /window\.scrollTo\(0, 0\);/);
  assert.match(css, /@media \(max-width: 768px\)/);
  assert.match(css, /width: min\(100%, 512px\)/);
  assert.match(css, /grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(css, /\.main-mode-actions \{[\s\S]*grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(css, /\.topic-samples > div \{[\s\S]*flex-wrap: wrap;/);
  assert.match(css, /\.difficulty-pick button\.selected::after/);
  assert.match(css, /\.lobby-settings \{[\s\S]*border: 2px solid var\(--ink\);[\s\S]*box-shadow: 7px 7px 0 var\(--ink\);/);
  assert.match(css, /\.lobby-settings h2 \{[\s\S]*font-size: clamp\(26px, 3vw, 36px\);/);
  assert.match(css, /env\(safe-area-inset-bottom\)/);
  assert.match(css, /\.lobby-start-action \{[\s\S]*position: fixed;/);
  assert.match(css, /\.room-code-card \{[\s\S]*order: -1;[\s\S]*grid-template-columns: auto minmax\(0, 1fr\) auto;/);
  assert.match(css, /\.lobby-setting-grid \{[\s\S]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(css, /\.invite-bar > div \{ display: none; \}/);
  assert.match(css, /\.player-list \{[\s\S]*max-height: 106px;[\s\S]*overflow-y: auto;/);
  assert.match(css, /\.rule-card > \.limit-display \{ display: none; \}/);
  assert.match(css, /\.standings \{ order: initial;/);
  assert.match(css, /\.answer-form \{[\s\S]*grid-template-columns: minmax\(0, 1fr\) auto;/);
  assert.match(css, /input, select \{ font-size: 16px; \}/);
  assert.match(css, /@media \(max-width: 340px\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /focus-visible/);
});
