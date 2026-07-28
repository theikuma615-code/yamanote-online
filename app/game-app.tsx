"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

type Player = {
  id: string;
  name: string;
  isHost: boolean;
  isAlive: boolean;
  score: number;
  isYou: boolean;
};

type GameState = {
  room: {
    code: string;
    status: "lobby" | "active" | "finished";
    topic: string | null;
    timeLimit: number;
    currentTurn: string | null;
    deadline: number | null;
    winnerId: string | null;
    round: number;
  };
  players: Player[];
  answers: { value: string; created_at: number; name: string }[];
  serverNow: number;
};

const avatars = ["🦊", "🐼", "🐸", "🐯", "🐨", "🐙", "🐧", "🦁"];

export default function GameApp() {
  const [screen, setScreen] = useState<"home" | "join" | "room">("home");
  const [name, setName] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [timeLimit, setTimeLimit] = useState(10);
  const [playerId, setPlayerId] = useState("");
  const [game, setGame] = useState<GameState | null>(null);
  const [answer, setAnswer] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [now, setNow] = useState(Date.now());
  const offsetRef = useRef(0);
  const answerRef = useRef<HTMLInputElement>(null);

  const call = useCallback(async (body: Record<string, unknown>) => {
    const response = await fetch("/api/game", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await response.json() as GameState & { error?: string; playerId?: string };
    if (!response.ok) throw new Error(data.error || "通信に失敗しました");
    if (data.playerId) setPlayerId(data.playerId);
    offsetRef.current = Date.now() - data.serverNow;
    setGame(data);
    setScreen("room");
    return data;
  }, []);

  useEffect(() => {
    if (!game || !playerId) return;
    const poll = window.setInterval(async () => {
      try {
        const response = await fetch(
          `/api/game?code=${game.room.code}&playerId=${encodeURIComponent(playerId)}`,
          { cache: "no-store" },
        );
        if (!response.ok) return;
        const data = await response.json() as GameState;
        offsetRef.current = Date.now() - data.serverNow;
        setGame(data);
      } catch {
        // The next poll will recover short connection drops.
      }
    }, 900);
    return () => window.clearInterval(poll);
  }, [game?.room.code, playerId]);

  useEffect(() => {
    if (game?.room.status !== "active") return;
    const timer = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(timer);
  }, [game?.room.status]);

  const you = game?.players.find((player) => player.id === playerId);
  const current = game?.players.find((player) => player.id === game.room.currentTurn);
  const isYourTurn = Boolean(you?.isAlive && current?.id === playerId);
  const remaining = game?.room.deadline
    ? Math.max(0, game.room.deadline - (now - offsetRef.current))
    : 0;
  const seconds = (remaining / 1000).toFixed(1);
  const timerPercent = game
    ? Math.max(0, Math.min(100, (remaining / (game.room.timeLimit * 1000)) * 100))
    : 100;

  useEffect(() => {
    if (isYourTurn) answerRef.current?.focus();
  }, [isYourTurn, game?.room.round]);

  const run = async (task: () => Promise<unknown>) => {
    setError("");
    setBusy(true);
    try {
      await task();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "操作に失敗しました");
    } finally {
      setBusy(false);
    }
  };

  const submitAnswer = (event: FormEvent) => {
    event.preventDefault();
    if (!game || !answer.trim()) return;
    run(async () => {
      await call({
        action: "answer",
        code: game.room.code,
        playerId,
        answer,
      });
      setAnswer("");
    });
  };

  const ranking = useMemo(
    () =>
      [...(game?.players ?? [])].sort(
        (a, b) => Number(b.isAlive) - Number(a.isAlive) || b.score - a.score,
      ),
    [game?.players],
  );

  const copyCode = async () => {
    if (!game) return;
    const invite = `${window.location.origin} ルームコード: ${game.room.code}`;
    await navigator.clipboard.writeText(invite);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  const reset = () => {
    setGame(null);
    setPlayerId("");
    setAnswer("");
    setError("");
    setScreen("home");
  };

  return (
    <main className="app-shell">
      <header className="topbar">
        <button className="brand" onClick={reset} aria-label="ホームへ戻る">
          <span className="brand-mark">Y</span>
          <span>
            <b>YAMANOTE</b>
            <em>RUSH</em>
          </span>
        </button>
        <div className="live-pill"><i /> ONLINE PARTY GAME</div>
        <button className="round-icon" aria-label="サウンド設定">♪</button>
      </header>

      {screen === "home" && (
        <section className="home-grid">
          <div className="hero-copy">
            <div className="eyebrow"><span>●</span> 最後の1人まで、止まれない。</div>
            <h1>つぎ、<br /><strong>言える？</strong></h1>
            <p>お題に答えて、次の人へ。<br />時間切れで即脱落のサドンデス。</p>
            <div className="mini-rules">
              <span><b>01</b> お題が出る</span>
              <i>→</i>
              <span><b>02</b> 順番に答える</span>
              <i>→</i>
              <span><b>03</b> 最後まで残る</span>
            </div>
          </div>

          <div className="ticket-card">
            <div className="ticket-stripe">
              <span>FRIEND MATCH</span>
              <span>2–8 PLAYERS</span>
            </div>
            <div className="ticket-body">
              <label>
                <span>プレイヤー名</span>
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="ニックネーム"
                  maxLength={12}
                  autoComplete="nickname"
                />
              </label>
              <div className="time-pick">
                <span>1回答の制限時間</span>
                <div>
                  {[5, 10, 15].map((value) => (
                    <button
                      key={value}
                      className={timeLimit === value ? "selected" : ""}
                      onClick={() => setTimeLimit(value)}
                    >
                      {value}秒
                    </button>
                  ))}
                </div>
              </div>
              <button
                className="primary-action"
                disabled={busy}
                onClick={() => run(() => call({
                  action: "create",
                  name,
                  timeLimit,
                  playerId: crypto.randomUUID(),
                }))}
              >
                <span>ルームをつくる</span><b>↗</b>
              </button>
              <div className="or-line"><span>または</span></div>
              <button className="join-action" onClick={() => setScreen("join")}>
                ルームコードで参加 <span>→</span>
              </button>
              {error && <p className="form-error" role="alert">{error}</p>}
            </div>
            <div className="ticket-cut left" /><div className="ticket-cut right" />
          </div>
          <div className="decor rail-a">YAMANOTE GAME • YAMANOTE GAME •</div>
          <div className="decor rail-b">NO PAUSE / NO REPEAT / ONE WINNER</div>
        </section>
      )}

      {screen === "join" && (
        <section className="join-screen">
          <button className="back-link" onClick={() => setScreen("home")}>← 戻る</button>
          <div className="join-panel">
            <span className="step-label">JOIN A ROOM</span>
            <h2>友達のルームへ<br /><strong>乗り込もう。</strong></h2>
            <label>
              <span>プレイヤー名</span>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="ニックネーム" maxLength={12} />
            </label>
            <label>
              <span>5桁のルームコード</span>
              <input
                className="code-input"
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 5))}
                placeholder="K8R2A"
                maxLength={5}
              />
            </label>
            <button
              className="primary-action"
              disabled={busy || joinCode.length !== 5}
              onClick={() => run(() => call({
                action: "join",
                code: joinCode,
                name,
                playerId: crypto.randomUUID(),
              }))}
            >
              <span>参加する</span><b>→</b>
            </button>
            {error && <p className="form-error" role="alert">{error}</p>}
          </div>
        </section>
      )}

      {screen === "room" && game?.room.status === "lobby" && (
        <section className="lobby-screen">
          <div className="room-heading">
            <div>
              <span className="step-label">WAITING ROOM</span>
              <h2>みんなが揃うまで、<br /><strong>ちょっと待って。</strong></h2>
            </div>
            <button className="code-chip" onClick={copyCode}>
              <small>ROOM CODE</small>
              <b>{game.room.code}</b>
              <span>{copied ? "コピーしました ✓" : "コピーする ⧉"}</span>
            </button>
          </div>
          <div className="lobby-content">
            <div className="players-card">
              <div className="section-title">
                <span>PLAYERS</span><b>{game.players.length}<small>/8</small></b>
              </div>
              <div className="player-list">
                {game.players.map((player, index) => (
                  <div className="lobby-player" key={player.id}>
                    <span className={`avatar avatar-${index % 4}`}>{avatars[index]}</span>
                    <b>{player.name}{player.isYou && <small> YOU</small>}</b>
                    {player.isHost ? <em>HOST</em> : <i>READY</i>}
                  </div>
                ))}
                {game.players.length < 8 && (
                  <div className="empty-player"><span>＋</span> 友達の参加を待っています…</div>
                )}
              </div>
            </div>
            <aside className="rule-card">
              <span className="rule-number">RULE / 03</span>
              <h3>言えなければ、<br />そこで脱落。</h3>
              <p>同じ答えは使えません。最後の1人になるまでゲームは続きます。</p>
              <div className="limit-display"><small>TIME LIMIT</small><b>{game.room.timeLimit}</b><span>SEC</span></div>
              {you?.isHost ? (
                <button
                  className="primary-action"
                  disabled={busy || game.players.length < 2}
                  onClick={() => run(() => call({
                    action: "start",
                    code: game.room.code,
                    playerId,
                  }))}
                >
                  <span>{game.players.length < 2 ? "あと1人でスタート" : "ゲームスタート"}</span><b>▶</b>
                </button>
              ) : (
                <div className="host-wait"><i /> ホストの開始を待っています</div>
              )}
              {error && <p className="form-error" role="alert">{error}</p>}
            </aside>
          </div>
        </section>
      )}

      {screen === "room" && game?.room.status === "active" && (
        <section className="game-screen">
          <div className="game-meta">
            <button className="compact-code" onClick={copyCode}>ROOM {game.room.code} ⧉</button>
            <span>ROUND {String(game.room.round).padStart(2, "0")}</span>
            <span className="sudden-pill">⚡ SUDDEN DEATH</span>
          </div>
          <div className="topic-board">
            <span>今回のお題</span>
            <h2>{game.room.topic}</h2>
            <p>同じ答えは使えません</p>
          </div>
          <div className="battle-layout">
            <div className="turn-panel">
              <div className="turn-status">
                <span className="avatar avatar-big">{avatars[Math.max(0, game.players.findIndex(p => p.id === current?.id)) % avatars.length]}</span>
                <div>
                  <small>NEXT ANSWER</small>
                  <h3>{isYourTurn ? "あなたの番！" : `${current?.name ?? "…"} の番`}</h3>
                </div>
                <div className={`countdown ${remaining < 3000 ? "danger" : ""}`}>
                  <b>{seconds}</b><small>SEC</small>
                </div>
              </div>
              <div className="timer-track"><i style={{ width: `${timerPercent}%` }} /></div>
              {you?.isAlive ? (
                <form className="answer-form" onSubmit={submitAnswer}>
                  <input
                    ref={answerRef}
                    value={answer}
                    onChange={(event) => setAnswer(event.target.value)}
                    placeholder={isYourTurn ? "答えを入力…" : "順番を待っています"}
                    disabled={!isYourTurn || busy}
                    maxLength={30}
                    aria-label="回答"
                  />
                  <button disabled={!isYourTurn || busy || !answer.trim()}>回答する <b>↵</b></button>
                </form>
              ) : (
                <div className="spectating">観戦中 — 勝負の行方を見届けよう</div>
              )}
              {error && <p className="game-error" role="alert">⚠ {error}</p>}
              <div className="answer-history">
                <span>RECENT ANSWERS</span>
                <div>
                  {game.answers.length ? game.answers.slice(0, 5).map((item, index) => (
                    <p key={`${item.created_at}-${index}`}><b>{item.value}</b><small>{item.name}</small></p>
                  )) : <em>最初の答えを待っています</em>}
                </div>
              </div>
            </div>
            <aside className="standings">
              <div className="section-title"><span>SURVIVORS</span><b>{game.players.filter(p => p.isAlive).length}</b></div>
              {ranking.map((player, index) => (
                <div className={`standing-player ${!player.isAlive ? "eliminated" : ""} ${player.id === current?.id ? "current" : ""}`} key={player.id}>
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <i className={`avatar avatar-${index % 4}`}>{avatars[game.players.findIndex(p => p.id === player.id) % avatars.length]}</i>
                  <b>{player.name}{player.isYou && <small> YOU</small>}</b>
                  <em>{player.isAlive ? `${player.score} PT` : "OUT"}</em>
                </div>
              ))}
            </aside>
          </div>
        </section>
      )}

      {screen === "room" && game?.room.status === "finished" && (
        <section className="result-screen">
          <div className="confetti c1">●</div><div className="confetti c2">◆</div>
          <div className="result-kicker">WE HAVE A WINNER</div>
          <div className="winner-avatar">👑<span>{avatars[Math.max(0, game.players.findIndex(p => p.id === game.room.winnerId)) % avatars.length]}</span></div>
          <h2>{game.players.find(p => p.id === game.room.winnerId)?.name ?? "WINNER"}</h2>
          <p>最後まで言い切った！<br /><strong>山手線ゲーム王</strong>の誕生です。</p>
          <div className="podium">
            {ranking.slice(0, 3).map((player, index) => (
              <div key={player.id} className={`place place-${index + 1}`}>
                <small>{index + 1}</small>
                <span>{avatars[game.players.findIndex(p => p.id === player.id) % avatars.length]}</span>
                <b>{player.name}</b><em>{player.score} PT</em>
              </div>
            ))}
          </div>
          <button className="primary-action result-button" onClick={reset}><span>もう一度あそぶ</span><b>↻</b></button>
        </section>
      )}

      <footer>
        <span>YAMANOTE RUSH™</span>
        <span>言って、つないで、生き残れ。</span>
        <span>MADE FOR FRIENDS</span>
      </footer>
    </main>
  );
}
