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
  assert.match(app, /今後実装します/);
  assert.match(route, /randomMatchTimeLimit = 15/);
  assert.match(route, /action === "update_settings"/);
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
  const css = await readFile(new URL("app/globals.css", root), "utf8");
  assert.match(css, /env\(safe-area-inset-bottom\)/);
  assert.match(css, /@media \(max-width: 340px\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /focus-visible/);
});
