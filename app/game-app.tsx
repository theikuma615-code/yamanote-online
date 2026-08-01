"use client";

import Image from "next/image";
import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

type Difficulty = "S" | "A" | "B" | "C";
type GameMode = "normal" | "bomb";
type TopicSwitchMode = "none" | "rounds" | "miss";
type Screen = "home" | "join" | "match" | "room" | "settings";

type Player = {
  id: string;
  name: string;
  isHost: boolean;
  isAlive: boolean;
  score: number;
  lives: number;
  isYou: boolean;
  eliminatedAt: number | null;
  isConnected: boolean;
};

type Answer = {
  value: string;
  topic: string;
  created_at: number;
  player_id: string;
  round: number;
  name: string;
};

type GameState = {
  room: {
    code: string;
    status: "lobby" | "starting" | "active" | "finished";
    topic: string | null;
    difficulty: Difficulty;
    timeLimit: number;
    mode: GameMode;
    topicSwitchMode: TopicSwitchMode;
    topicSwitchRounds: number;
    selectedTopic: string | null;
    lifeEnabled: boolean;
    lifeCount: number;
    bombDuration: number;
    bombTopicSwitchEnabled: boolean;
    availableTopics: string[];
    currentTurn: string | null;
    deadline: number | null;
    bombDeadline: number | null;
    winnerId: string | null;
    finishReason: "completed" | "last_survivor" | null;
    isCompletable: boolean;
    totalAnswers: number | null;
    answerCount: number;
    round: number;
  };
  players: Player[];
  answers: Answer[];
  serverNow: number;
};

type MatchResponse = Partial<GameState> & {
  error?: string;
  playerId?: string;
  matchmaking?: {
    status: "waiting" | "cancelled";
    difficulty?: Difficulty;
    timeLimit?: number;
    queuedAt?: number;
    waitingCount?: number;
  };
};

type StoredSession = {
  roomCode: string;
  playerId: string;
  name: string;
};

const avatars = ["🦊", "🐼", "🐸", "🐯", "🐨", "🐙", "🐧", "🦁"];
const difficultyLabels = {
  S: "超難問",
  A: "むずかしい",
  B: "ふつう",
  C: "やさしい",
} as const;
const topicExamples: Record<Difficulty, string[]> = {
  S: ["医学部がある大学", "3000m以上の山", "赤道が通る国", "100km²以上の湖"],
  A: ["東京23区", "アメリカの州", "EU加盟国", "元素"],
  B: ["山手線の駅", "県庁所在地", "海なし県", "草冠の漢字"],
  C: ["都道府県", "国", "動物", "果物", "お寿司のネタ"],
};
const randomMatchTimeLimit = 15;
const sessionKey = "yamanote-online-session";
const soundKey = "yamanote-online-sound";
const soundEvent = "yamanote-sound-change";

function subscribeSoundPreference(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener(soundEvent, callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(soundEvent, callback);
  };
}

function getSoundPreference() {
  return window.localStorage.getItem(soundKey) !== "off";
}

function getServerSoundPreference() {
  return true;
}

function saveSession(session: StoredSession) {
  window.localStorage.setItem(sessionKey, JSON.stringify(session));
}

function clearSession() {
  window.localStorage.removeItem(sessionKey);
}

function readSession(): StoredSession | null {
  try {
    const stored = window.localStorage.getItem(sessionKey);
    return stored ? JSON.parse(stored) as StoredSession : null;
  } catch {
    return null;
  }
}

async function writeClipboard(value: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

export default function GameApp() {
  const [screen, setScreen] = useState<Screen>("home");
  const [name, setName] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [timeLimit] = useState(15);
  const [difficulty, setDifficulty] = useState<Difficulty>("C");
  const [playerId, setPlayerId] = useState("");
  const [game, setGame] = useState<GameState | null>(null);
  const [answer, setAnswer] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(0);
  const [serverOffset, setServerOffset] = useState(0);
  const [toast, setToast] = useState("");
  const [rulesOpen, setRulesOpen] = useState(false);
  const [lobbySettingsOpen, setLobbySettingsOpen] = useState(false);
  const [leaveConfirmOpen, setLeaveConfirmOpen] = useState(false);
  const [matchingSince, setMatchingSince] = useState(0);
  const [matchingElapsed, setMatchingElapsed] = useState(0);
  const [waitingCount, setWaitingCount] = useState<number | null>(null);
  const [connection, setConnection] = useState<"online" | "reconnecting" | "offline">("online");
  const [latestPlayerId, setLatestPlayerId] = useState("");
  const nameRef = useRef<HTMLInputElement>(null);
  const answerRef = useRef<HTMLInputElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const playerAnimationTimerRef = useRef<number | null>(null);
  const previousPlayerIdsRef = useRef<Set<string>>(new Set());
  const gameRef = useRef<GameState | null>(null);
  const flowVersionRef = useRef(0);
  const soundEnabled = useSyncExternalStore(
    subscribeSoundPreference,
    getSoundPreference,
    getServerSoundPreference,
  );

  const notify = useCallback((message: string) => {
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    setToast(message);
    toastTimerRef.current = window.setTimeout(() => setToast(""), 2600);
  }, []);

  const playTone = useCallback((frequency = 660, force = false) => {
    if (!force && window.localStorage.getItem(soundKey) === "off") return;
    try {
      const AudioContextClass = window.AudioContext;
      const context = audioContextRef.current ?? new AudioContextClass();
      audioContextRef.current = context;
      void context.resume();
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.frequency.value = frequency;
      oscillator.type = "sine";
      gain.gain.setValueAtTime(0.0001, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.09, context.currentTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.16);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start();
      oscillator.stop(context.currentTime + 0.18);
    } catch {
      // Audio is an enhancement. Browsers may block it before user interaction.
    }
  }, []);

  const acceptGameState = useCallback((
    data: GameState,
    effectivePlayerId: string,
  ) => {
    const previousIds = previousPlayerIdsRef.current;
    const newcomer = data.room.status === "lobby"
      ? data.players.find((player) => !previousIds.has(player.id))
      : undefined;
    if (previousIds.size > 0 && newcomer && newcomer.id !== effectivePlayerId) {
      notify(`${newcomer.name}さんが参加しました`);
      playTone(780);
      setLatestPlayerId(newcomer.id);
      if (playerAnimationTimerRef.current) {
        window.clearTimeout(playerAnimationTimerRef.current);
      }
      playerAnimationTimerRef.current = window.setTimeout(
        () => setLatestPlayerId(""),
        1500,
      );
    }
    previousPlayerIdsRef.current = new Set(data.players.map((player) => player.id));
    gameRef.current = data;
    setServerOffset(Date.now() - data.serverNow);
    setGame(data);
    setConnection("online");
    if (data.room.status !== "lobby") {
      setScreen((currentScreen) =>
        currentScreen === "settings" ? "room" : currentScreen
      );
    }
    if (effectivePlayerId) {
      const self = data.players.find((player) => player.id === effectivePlayerId);
      if (data.room.status === "finished") {
        clearSession();
      } else {
        saveSession({
          roomCode: data.room.code,
          playerId: effectivePlayerId,
          name: self?.name ?? "",
        });
      }
    }
  }, [notify, playTone]);

  const call = useCallback(async (body: Record<string, unknown>) => {
    const flowVersion = flowVersionRef.current;
    const response = await fetch("/api/game", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await response.json() as GameState & {
      error?: string;
      playerId?: string;
      notice?: string;
    };
    if (!response.ok) throw new Error(data.error || "通信に失敗しました");
    if (flowVersion !== flowVersionRef.current) return data;
    const effectivePlayerId = data.playerId ?? String(body.playerId ?? playerId);
    if (data.playerId) setPlayerId(data.playerId);
    acceptGameState(data, effectivePlayerId);
    if (data.notice) notify(data.notice);
    if (body.action !== "update_settings") setScreen("room");
    return data;
  }, [acceptGameState, notify, playerId]);

  const matchRequest = useCallback(async (body: Record<string, unknown>) => {
    const flowVersion = flowVersionRef.current;
    const response = await fetch("/api/game", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await response.json() as MatchResponse;
    if (!response.ok) throw new Error(data.error || "マッチングに失敗しました");
    if (flowVersion !== flowVersionRef.current) return data;
    const effectivePlayerId = data.playerId ?? String(body.playerId ?? playerId);
    if (data.playerId) setPlayerId(data.playerId);
    if (data.matchmaking) {
      setWaitingCount(data.matchmaking.waitingCount ?? null);
      if (data.matchmaking.queuedAt) setMatchingSince(data.matchmaking.queuedAt);
    }
    if (data.room && data.players && data.answers && data.serverNow) {
      acceptGameState(data as GameState, effectivePlayerId);
      setScreen(data.room.status === "starting" ? "match" : "room");
    }
    return data;
  }, [acceptGameState, playerId]);

  useEffect(() => {
    const flowVersion = flowVersionRef.current;
    const restore = async () => {
      await Promise.resolve();
      if (flowVersion !== flowVersionRef.current) return;
      const inviteCode = new URLSearchParams(window.location.search)
        .get("room")
        ?.toUpperCase()
        .replace(/[^A-Z0-9]/g, "")
        .slice(0, 5) ?? "";
      const stored = readSession();
      if (inviteCode && stored?.roomCode !== inviteCode) {
        setJoinCode(inviteCode);
        setScreen("join");
        return;
      }
      if (!stored) {
        if (inviteCode) {
          setJoinCode(inviteCode);
          setScreen("join");
        }
        return;
      }
      try {
        const response = await fetch(
          `/api/game?code=${stored.roomCode}&playerId=${encodeURIComponent(stored.playerId)}`,
          { cache: "no-store" },
        );
        if (!response.ok) throw new Error("保存したルームへ再接続できませんでした");
        const data = await response.json() as GameState;
        if (flowVersion !== flowVersionRef.current) return;
        if (data.room.status === "finished") {
          clearSession();
          setScreen("home");
          return;
        }
        setName(stored.name);
        setPlayerId(stored.playerId);
        acceptGameState(data, stored.playerId);
        setScreen(data.room.status === "starting" ? "match" : "room");
        notify("ルームへ再接続しました");
      } catch {
        if (flowVersion !== flowVersionRef.current) return;
        clearSession();
        setConnection("offline");
        setError("以前のルームへ再接続できませんでした。ルームが終了した可能性があります。");
      }
    };
    void restore();
  }, [acceptGameState, notify]);

  useEffect(() => {
    if (screen !== "match" || !playerId) return;
    const flowVersion = flowVersionRef.current;
    const poll = window.setInterval(async () => {
      try {
        await matchRequest({ action: "match_status", playerId });
      } catch (cause) {
        if (flowVersion !== flowVersionRef.current) return;
        setConnection("reconnecting");
        setError(cause instanceof Error ? cause.message : "マッチングに失敗しました");
      }
    }, 1000);
    return () => window.clearInterval(poll);
  }, [screen, playerId, matchRequest]);

  const roomCode = game?.room.code;

  useEffect(() => {
    if (!roomCode || !playerId) return;
    const flowVersion = flowVersionRef.current;
    let failures = 0;
    const poll = window.setInterval(async () => {
      try {
        const response = await fetch(
          `/api/game?code=${roomCode}&playerId=${encodeURIComponent(playerId)}`,
          { cache: "no-store" },
        );
        if (!response.ok) throw new Error("再接続できません");
        const data = await response.json() as GameState;
        if (flowVersion !== flowVersionRef.current) return;
        failures = 0;
        acceptGameState(data, playerId);
      } catch {
        if (flowVersion !== flowVersionRef.current) return;
        failures += 1;
        setConnection(failures >= 5 ? "offline" : "reconnecting");
      }
    }, 1000);
    return () => window.clearInterval(poll);
  }, [roomCode, playerId, acceptGameState]);

  useEffect(() => {
    if (game?.room.status !== "active") return;
    const timer = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(timer);
  }, [game?.room.status]);

  useEffect(() => {
    if (screen !== "match" || !matchingSince) return;
    const timer = window.setInterval(() => {
      setMatchingElapsed(Math.max(0, Math.floor((Date.now() - matchingSince) / 1000)));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [screen, matchingSince]);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [screen, game?.room.status]);

  useEffect(() => () => {
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    if (playerAnimationTimerRef.current) {
      window.clearTimeout(playerAnimationTimerRef.current);
    }
    void audioContextRef.current?.close();
  }, []);

  const you = game?.players.find((player) => player.id === playerId);
  const current = game?.players.find((player) => player.id === game.room.currentTurn);
  const isYourTurn = Boolean(you?.isAlive && current?.id === playerId);
  const remaining = game?.room.deadline
    ? Math.max(
      0,
      game.room.deadline - (now ? now - serverOffset : game.serverNow),
    )
    : 0;
  const seconds = (remaining / 1000).toFixed(1);
  const bombRemaining = game?.room.bombDeadline
    ? Math.max(
      0,
      game.room.bombDeadline - (now ? now - serverOffset : game.serverNow),
    )
    : 0;
  const bombSeconds = Math.ceil(bombRemaining / 1000);
  const timerPercent = game
    ? Math.max(
      0,
      Math.min(
        100,
        (remaining /
          (game.room.mode === "bomb" ? 30_000 : game.room.timeLimit * 1000)) *
          100,
      ),
    )
    : 100;

  useEffect(() => {
    if (isYourTurn) {
      answerRef.current?.focus();
      playTone(880);
    }
  }, [isYourTurn, game?.room.round, playTone]);

  const run = async (task: () => Promise<unknown>) => {
    if (busy) return;
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
    if (!game || !answer.trim() || busy) return;
    void run(async () => {
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
        (a, b) =>
          Number(b.isAlive) - Number(a.isAlive) ||
          (b.eliminatedAt ?? Number.MAX_SAFE_INTEGER) -
            (a.eliminatedAt ?? Number.MAX_SAFE_INTEGER) ||
          b.score - a.score,
      ),
    [game?.players],
  );

  const eliminatedPlayers = useMemo(
    () =>
      [...(game?.players ?? [])]
        .filter((player) => !player.isAlive)
        .sort((a, b) => (a.eliminatedAt ?? 0) - (b.eliminatedAt ?? 0)),
    [game?.players],
  );

  const inviteUrl = () => {
    if (!game) return window.location.origin;
    const url = new URL(window.location.origin);
    url.searchParams.set("room", game.room.code);
    return url.toString();
  };

  const copyRoomCode = async () => {
    if (!game) return;
    await writeClipboard(game.room.code);
    notify("ルームコードをコピーしました");
  };

  const copyInviteUrl = async () => {
    await writeClipboard(inviteUrl());
    notify("招待URLをコピーしました");
  };

  const shareInvite = async () => {
    if (!game) return;
    const shareData = {
      title: "山手線ゲームオンライン",
      text: "山手線ゲームオンラインで一緒に遊ぼう！",
      url: inviteUrl(),
    };
    if (navigator.share) {
      try {
        await navigator.share(shareData);
        return;
      } catch (cause) {
        if (cause instanceof DOMException && cause.name === "AbortError") return;
      }
    }
    await copyInviteUrl();
  };

  const clearGameState = () => {
    flowVersionRef.current += 1;
    gameRef.current = null;
    previousPlayerIdsRef.current = new Set();
    setGame(null);
    setPlayerId("");
    setAnswer("");
    setError("");
    setConnection("online");
    setWaitingCount(null);
    setMatchingElapsed(0);
    setMatchingSince(0);
    setLobbySettingsOpen(false);
    setLeaveConfirmOpen(false);
  };

  const goHome = () => {
    clearSession();
    clearGameState();
    window.history.replaceState({}, "", window.location.pathname);
    setScreen("home");
  };

  const requirePlayerName = () => {
    if (name.trim()) return true;
    setError("プレイヤー名を入力してください");
    nameRef.current?.focus();
    return false;
  };

  const createFriendRoom = async () => {
    if (!requirePlayerName()) return;
    clearSession();
    clearGameState();
    const id = crypto.randomUUID();
    setPlayerId(id);
    await call({
      action: "create",
      name,
      timeLimit,
      difficulty,
      playerId: id,
    });
  };

  const joinFriendRoom = async () => {
    clearSession();
    clearGameState();
    const id = crypto.randomUUID();
    setPlayerId(id);
    await call({
      action: "join",
      code: joinCode,
      name,
      playerId: id,
    });
  };

  const startRandomMatch = () => {
    if (!requirePlayerName()) return;
    clearSession();
    clearGameState();
    const id = crypto.randomUUID();
    setPlayerId(id);
    setMatchingSince(Date.now());
    setMatchingElapsed(0);
    void run(async () => {
      const data = await matchRequest({
        action: "matchmake",
        name,
        difficulty,
        timeLimit: randomMatchTimeLimit,
        playerId: id,
      });
      if (!data.room) setScreen("match");
    });
  };

  const cancelMatch = async () => {
    if (playerId) {
      try {
        await matchRequest({ action: "cancel_match", playerId });
      } catch {
        // The local screen can still safely return home.
      }
    }
    goHome();
  };

  const switchToFriendRoom = async () => {
    if (playerId) {
      try {
        await matchRequest({ action: "cancel_match", playerId });
      } catch {
        // Continue with a new friend room even if the stale queue is unreachable.
      }
    }
    clearGameState();
    await createFriendRoom();
  };

  const leaveRoom = async () => {
    if (!game) return;
    const needsConfirmation = game.room.status === "active";
    if (
      needsConfirmation &&
      !window.confirm("ゲームから退出しますか？退出すると脱落扱いになります。")
    ) return;
    try {
      await fetch("/api/game", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "leave",
          code: game.room.code,
          playerId,
        }),
        keepalive: true,
      });
    } finally {
      goHome();
    }
  };

  const requestLeaveRoom = () => {
    if (!game) return;
    if (game.room.status === "lobby") {
      setLeaveConfirmOpen(true);
      return;
    }
    void leaveRoom();
  };

  const rematch = async () => {
    if (!game) return;
    await call({
      action: "rematch",
      code: game.room.code,
      playerId,
    });
    notify("同じメンバーで再戦します");
  };

  const updateRoomSettings = async (updates: Record<string, unknown>) => {
    if (!game || !you?.isHost) return;
    await call({
      action: "update_settings",
      code: game.room.code,
      playerId,
      ...updates,
    });
    notify("ルーム設定を変更しました");
  };

  const shareResult = async () => {
    if (!game) return;
    const winner = game.players.find((player) => player.id === game.room.winnerId);
    const resultText = game.room.finishReason === "completed"
      ? `山手線ゲームオンラインで全員クリア！\nお題：${game.room.topic}\n参加者：${game.players.length}人`
      : `山手線ゲームオンラインで${winner?.name ?? "勝者"}が優勝！\nお題：${game.room.topic}\n参加者：${game.players.length}人`;
    if (navigator.share) {
      try {
        await navigator.share({
          title: "山手線ゲームオンラインの結果",
          text: resultText,
          url: window.location.origin,
        });
        return;
      } catch (cause) {
        if (cause instanceof DOMException && cause.name === "AbortError") return;
      }
    }
    await writeClipboard(`${resultText}\n${window.location.origin}`);
    notify("結果をコピーしました");
  };

  const toggleSound = () => {
    const next = !soundEnabled;
    window.localStorage.setItem(soundKey, next ? "on" : "off");
    window.dispatchEvent(new Event(soundEvent));
    if (next) playTone(720, true);
    notify(next ? "効果音をオンにしました" : "効果音をオフにしました");
  };

  const formatElapsed = (value: number) =>
    `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;

  return (
    <main
      className={[
        "app-shell",
        `screen-${screen}`,
        game?.room.status ? `room-${game.room.status}` : "",
      ].filter(Boolean).join(" ")}
    >
      <header className="topbar">
        <button
          className="brand"
          onClick={() => {
            if (screen === "match") void cancelMatch();
            else if (screen === "room" || screen === "settings") requestLeaveRoom();
            else goHome();
          }}
          aria-label="ホームへ戻る"
        >
          <Image
            className="brand-logo"
            src="/logo-mark.png"
            alt=""
            width={48}
            height={48}
            priority
          />
          <span>
            <b>山手線ゲーム</b>
            <em>オンライン</em>
          </span>
        </button>
        <div className="live-pill"><i /> ONLINE PARTY GAME</div>
        <button
          className={`sound-toggle ${soundEnabled ? "on" : "off"}`}
          onClick={toggleSound}
          aria-label={`効果音を${soundEnabled ? "オフ" : "オン"}にする`}
          aria-pressed={soundEnabled}
        >
          <span aria-hidden="true">{soundEnabled ? "🔊" : "🔇"}</span>
          <b>効果音 {soundEnabled ? "ON" : "OFF"}</b>
        </button>
      </header>

      {connection !== "online" && (
        <div className={`connection-banner ${connection}`} role="status">
          <span aria-hidden="true">↻</span>
          <b>
            {connection === "reconnecting"
              ? "接続が切れました。再接続しています…"
              : "再接続できません。通信環境を確認してください。"}
          </b>
          {connection === "offline" && (
            <button onClick={() => window.location.reload()}>再読み込み</button>
          )}
        </div>
      )}

      {screen === "home" && (
        <section className="home-grid">
          <div className="home-intro">
            <div className="hero-copy">
              <div className="eyebrow"><span>●</span> 最後の1人まで、止まれない。</div>
              <h1><span>つぎ、</span><strong>言える？</strong></h1>
              <p>お題に合う言葉を文字で入力。<br />通常モードも爆弾モードも楽しめます。</p>
            </div>

            <div className="home-learning">
              <h2 className="mobile-section-title">遊び方</h2>
              <div className="mini-rules" aria-label="ゲームの流れ">
                <span><b>01</b> お題が出る</span>
                <i>→</i>
                <span><b>02</b> 順番に入力</span>
                <i>→</i>
                <span><b>03</b> 最後まで残る</span>
              </div>
              <div className="topic-samples">
                <span>LEVEL {difficulty} のお題例</span>
                <div>
                  {topicExamples[difficulty].map((topic) => (
                    <em key={topic}># {topic}</em>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="ticket-card">
            <div className="ticket-stripe">
              <span>GAME TICKET</span>
              <span>2–8 PLAYERS</span>
            </div>
            <div className="ticket-body">
              <label>
                <span>プレイヤー名（12文字まで）</span>
                <input
                  ref={nameRef}
                  value={name}
                  onChange={(event) => setName(event.target.value.slice(0, 12))}
                  placeholder="ニックネーム"
                  maxLength={12}
                  autoComplete="nickname"
                />
              </label>
              <div className="difficulty-pick">
                <span>お題の難易度</span>
                <div>
                  {(["S", "A", "B", "C"] as const).map((level) => (
                    <button
                      key={level}
                      className={`level-${level.toLowerCase()} ${difficulty === level ? "selected" : ""}`}
                      onClick={() => setDifficulty(level)}
                      aria-pressed={difficulty === level}
                      aria-label={`難易度${level}、${difficultyLabels[level]}`}
                    >
                      <b>{level}</b><small>{difficultyLabels[level]}</small>
                    </button>
                  ))}
                </div>
              </div>
              <div className="main-mode-actions">
                <button
                  className="primary-action friend-primary"
                  disabled={busy}
                  onClick={() => void run(createFriendRoom)}
                >
                  <span>友達ルームをつくる</span><b>↗</b>
                </button>
                <button
                  className="secondary-action random-action"
                  disabled={busy}
                  onClick={startRandomMatch}
                >
                  <span>ランダムマッチ<small>15秒固定</small></span><b>⚡</b>
                </button>
              </div>
              <button
                className="join-action"
                onClick={() => {
                  setError("");
                  setScreen("join");
                }}
              >
                ルームコードで参加 <span>→</span>
              </button>
              {error && <p className="form-error" role="alert">⚠ {error}</p>}
            </div>
          </div>
          <div className="decor rail-b">NO PAUSE / NO REPEAT / CLEAR TOGETHER</div>
        </section>
      )}

      {screen === "match" && (
        <section className="match-screen">
          <div className="match-panel">
            <span className="step-label">RANDOM MATCH / 1 VS 1</span>
            <div className="match-radar" aria-label="対戦相手を検索中">
              <i /><i /><i />
              <span>{avatars[0]}</span>
              <span>{avatars[3]}</span>
            </div>
            <h2>
              {game?.room.status === "starting" ? (
                <>対戦相手が<br /><strong>見つかりました！</strong></>
              ) : (
                <>対戦相手を<br /><strong>探しています…</strong></>
              )}
            </h2>
            <div className="match-conditions">
              <span><small>LEVEL</small><b>{difficulty}</b></span>
              <span><small>TIME</small><b>{randomMatchTimeLimit}<em>秒</em></b></span>
              <span><small>WAIT</small><b>{formatElapsed(matchingElapsed)}</b></span>
            </div>
            <div className="waiting-meta" aria-live="polite">
              {waitingCount !== null && <b>同じ条件で待機中：{waitingCount}人</b>}
              <p>
                {game?.room.status === "starting"
                  ? "両プレイヤーの準備ができ次第、同時にスタートします。"
                  : "登録済み回答は自動判定。同じ回答は使えません。"}
              </p>
            </div>
            <div className="waiting-topics">
              <span>このレベルのお題例</span>
              <div>
                {topicExamples[difficulty].slice(0, 3).map((topic) => (
                  <em key={topic}># {topic}</em>
                ))}
              </div>
            </div>
            {matchingElapsed >= 15 && !game?.room && (
              <div className="wait-alternative">
                <b>友達を誘ってすぐ遊ぶこともできます</b>
                <button
                  disabled={busy || !name.trim()}
                  onClick={() => void run(switchToFriendRoom)}
                >
                  友達ルームをつくる →
                </button>
              </div>
            )}
            {error && <p className="form-error" role="alert">⚠ {error}</p>}
            <button className="cancel-match" onClick={() => void cancelMatch()}>
              マッチングをキャンセル
            </button>
          </div>
        </section>
      )}

      {screen === "join" && (
        <section className="join-screen">
          <button className="back-link" onClick={goHome}>← 戻る</button>
          <div className="join-panel">
            <span className="step-label">JOIN A ROOM</span>
            <h2>友達のルームへ<br /><strong>乗り込もう。</strong></h2>
            <p className="join-note">招待されたルームコードを確認して、名前を入力してください。</p>
            <label>
              <span>プレイヤー名（12文字まで）</span>
              <input
                value={name}
                onChange={(event) => setName(event.target.value.slice(0, 12))}
                placeholder="ニックネーム"
                maxLength={12}
                autoComplete="nickname"
              />
            </label>
            <label>
              <span>5桁のルームコード</span>
              <input
                className="code-input"
                value={joinCode}
                onChange={(event) =>
                  setJoinCode(
                    event.target.value
                      .toUpperCase()
                      .replace(/[^A-Z0-9]/g, "")
                      .slice(0, 5),
                  )}
                placeholder="K8R2A"
                maxLength={5}
              />
            </label>
            <button
              className="primary-action"
              disabled={busy || !name.trim() || joinCode.length !== 5}
              onClick={() => void run(joinFriendRoom)}
            >
              <span>参加する</span><b>→</b>
            </button>
            <button className="text-action" onClick={() => setRulesOpen(true)}>
              参加前に遊び方を見る
            </button>
            {error && <p className="form-error" role="alert">⚠ {error}</p>}
          </div>
        </section>
      )}

      {screen === "room" && game?.room.status === "lobby" && (
        <section className="lobby-screen">
          <div className="room-heading">
            <div className={`lobby-settings ${lobbySettingsOpen ? "expanded" : ""} ${you?.isHost ? "" : "read-only"}`}>
              <span className="step-label">WAITING ROOM</span>
              <h2>ルーム設定</h2>
              <p>{game.players.length} / 8人が参加中</p>
              <div className="lobby-settings-summary">
                <span>現在の設定</span>
                <b>
                  レベル{game.room.difficulty}・
                  {game.room.mode === "bomb"
                    ? `爆弾${game.room.bombDuration / 60}分`
                    : `回答時間${game.room.timeLimit}秒`}
                </b>
                <button
                  disabled={busy || !you?.isHost}
                  aria-expanded={lobbySettingsOpen}
                  onClick={() => setLobbySettingsOpen((current) => !current)}
                >
                  {you?.isHost ? (lobbySettingsOpen ? "閉じる" : "変更") : "ホストのみ"}
                </button>
              </div>
              <div className="lobby-settings-detail">
                <div className="lobby-setting-grid">
                  <fieldset>
                    <legend>お題レベル</legend>
                    <div className="compact-levels">
                      {(["S", "A", "B", "C"] as const).map((level) => (
                        <button
                          key={level}
                          className={`level-${level.toLowerCase()} ${game.room.difficulty === level ? "selected" : ""}`}
                          disabled={busy || !you?.isHost}
                          onClick={() => void run(() =>
                            updateRoomSettings({ difficulty: level })
                          )}
                          aria-pressed={game.room.difficulty === level}
                          aria-label={`お題レベル${level}、${difficultyLabels[level]}`}
                        >
                          {level}
                        </button>
                      ))}
                    </div>
                  </fieldset>
                  <fieldset>
                    <legend>
                      {game.room.mode === "bomb" ? "爆弾タイマー" : "回答時間"}
                    </legend>
                    {game.room.mode === "bomb" ? (
                      <div className="compact-times">
                        {([
                          [60, "1分"],
                          [180, "3分"],
                          [300, "5分"],
                        ] as const).map(([value, label]) => (
                          <button
                            key={value}
                            className={game.room.bombDuration === value ? "selected bomb" : ""}
                            disabled={busy || !you?.isHost}
                            onClick={() => void run(() =>
                              updateRoomSettings({ bombDuration: value })
                            )}
                            aria-pressed={game.room.bombDuration === value}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    ) : (
                      <div className="compact-times">
                        {[10, 15, 20].map((value) => (
                          <button
                            key={value}
                            className={game.room.timeLimit === value ? "selected" : ""}
                            disabled={busy || !you?.isHost}
                            onClick={() => void run(() =>
                              updateRoomSettings({ timeLimit: value })
                            )}
                            aria-pressed={game.room.timeLimit === value}
                          >
                            {value}秒
                          </button>
                        ))}
                      </div>
                    )}
                  </fieldset>
                </div>
                <div className="lobby-setting-footer">
                  <span>{you?.isHost ? "ホストが変更できます" : "ホストが設定を変更できます"}</span>
                  <button onClick={() => setScreen("settings")}>詳細設定 →</button>
                </div>
              </div>
            </div>
            <div className="room-code-card">
              <small>ROOM CODE</small>
              <b>{game.room.code}</b>
              <button onClick={() => void copyRoomCode()}>
                {toast === "ルームコードをコピーしました" ? "コピーしました" : "コードをコピー ⧉"}
              </button>
            </div>
          </div>
          <div className="invite-bar">
            <div>
              <b>友達を招待</b>
              <span>URLを送るだけで、このルームへ参加できます。</span>
            </div>
            <button className="invite-main invite-desktop-action" onClick={() => void shareInvite()}>
              <span aria-hidden="true">↗</span> 共有する
            </button>
            <button className="invite-desktop-action" onClick={() => void copyInviteUrl()}>招待URLをコピー</button>
            <button className="invite-mobile-action" onClick={() => void shareInvite()}>
              <span aria-hidden="true">↗</span> 友達を招待
            </button>
          </div>
          <div className="lobby-content">
            <div className="players-card">
              <div className="section-title">
                <span><i className="desktop-player-label">PLAYERS</i><i className="mobile-player-label">参加者</i></span>
                <b>{game.players.length}<small> / 8人</small></b>
              </div>
              <div className="player-list" aria-live="polite">
                {game.players.map((player, index) => (
                  <div
                    className={`lobby-player ${latestPlayerId === player.id ? "just-joined" : ""}`}
                    key={player.id}
                  >
                    <span className={`avatar avatar-${index % 4}`}>{avatars[index]}</span>
                    <b>
                      {player.name}{player.isYou && <small> YOU</small>}
                      {!player.isConnected && <small className="offline-label"> 再接続待ち</small>}
                    </b>
                    {player.isHost ? <em>HOST</em> : <i>READY</i>}
                  </div>
                ))}
                {game.players.length < 8 && (
                  <div className="empty-player"><span>＋</span> 友達の参加を待っています…</div>
                )}
              </div>
              {game.players.length < 8 && (
                <p className="mobile-player-wait">友達の参加を待っています…</p>
              )}
            </div>
            <aside className="rule-card">
              <span className="rule-number">
                <i className="desktop-mode-label">
                  {game.room.mode === "bomb" ? "BOMB MODE" : "NORMAL MODE"} / LEVEL {game.room.difficulty}
                </i>
                <i className="mobile-mode-label">
                  {game.room.mode === "bomb" ? "爆弾モード" : "通常モード"}・レベル{game.room.difficulty}
                </i>
              </span>
              <h3>
                {game.room.mode === "bomb"
                  ? <>答えて、爆弾を<br />次の人へ。</>
                  : <>文字で答えて、<br />つないでいく。</>}
              </h3>
              {game.room.mode === "bomb" ? (
                <p>
                  答えると爆弾が次の人へ移ります。
                  {game.room.bombTopicSwitchEnabled &&
                    " 30秒答えられないとお題が変わります。"}
                  爆発した瞬間に持っていた人が脱落し、受け取った人には最低5秒が保証されます。
                </p>
              ) : (
                <p>
                  同じ回答や登録済みの表記揺れは使えません。
                  {game.room.lifeEnabled
                    ? ` 間違いや時間切れでライフが1つ減り、${game.room.lifeCount}個すべて失うと脱落します。`
                    : " 間違いや時間切れで脱落します。"}
                </p>
              )}
              <button className="rule-link" onClick={() => setRulesOpen(true)}>
                詳しい遊び方を見る
              </button>
              <div className={`limit-display ${game.room.mode === "bomb" ? "bomb" : ""}`}>
                <small>{game.room.mode === "bomb" ? "BOMB TIMER" : "TIME LIMIT"}</small>
                <b>{game.room.mode === "bomb" ? game.room.bombDuration / 60 : game.room.timeLimit}</b>
                <span>{game.room.mode === "bomb" ? "MIN" : "SEC"}</span>
              </div>
              {you?.isHost ? (
                <button
                  className="primary-action lobby-start-action"
                  disabled={busy || game.players.length < 2}
                  onClick={() => void run(() => call({
                    action: "start",
                    code: game.room.code,
                    playerId,
                  }))}
                >
                  <span>{game.players.length < 2 ? "あと1人でスタート" : "ゲームをスタート"}</span><b>▶</b>
                </button>
              ) : (
                <div className="host-wait"><i /> ホストの開始を待っています</div>
              )}
              <button className="leave-link" onClick={requestLeaveRoom}>退出</button>
              {error && <p className="form-error" role="alert">⚠ {error}</p>}
            </aside>
          </div>
        </section>
      )}

      {screen === "settings" && game?.room.status === "lobby" && (
        <section className="settings-screen">
          <button className="back-link" onClick={() => setScreen("room")}>← 待機画面へ戻る</button>
          <div className="settings-panel">
            <span className="step-label">DETAIL SETTINGS</span>
            <h2>詳細設定</h2>
            <p className="settings-owner-note">
              {you?.isHost ? "ホストがルールを変更できます。" : "設定の変更はホストだけが行えます。"}
            </p>
            <div className="settings-mode-tabs" aria-label="ゲームモード">
              <button
                className={game.room.mode === "normal" ? "selected" : ""}
                disabled={busy || !you?.isHost}
                onClick={() => void run(() =>
                  updateRoomSettings({ mode: "normal" })
                )}
                aria-pressed={game.room.mode === "normal"}
              >
                <b>通常モード</b>
                <small>順番に答えて生き残る</small>
              </button>
              <button
                className={game.room.mode === "bomb" ? "selected bomb" : "bomb"}
                disabled={busy || !you?.isHost}
                onClick={() => void run(() =>
                  updateRoomSettings({ mode: "bomb" })
                )}
                aria-pressed={game.room.mode === "bomb"}
              >
                <b>爆弾モード</b>
                <small>爆発時に持っていた人が脱落</small>
              </button>
            </div>
            <div className="detail-setting-list">
              <section>
                <div className="detail-setting-heading">
                  <b>お題の難易度</b><span>LEVEL</span>
                </div>
                <div className="detail-choice-grid four">
                  {(["S", "A", "B", "C"] as const).map((level) => (
                    <button
                      key={level}
                      className={`level-${level.toLowerCase()} ${game.room.difficulty === level ? "selected" : ""}`}
                      disabled={busy || !you?.isHost}
                      onClick={() => void run(() =>
                        updateRoomSettings({ difficulty: level })
                      )}
                      aria-pressed={game.room.difficulty === level}
                    >
                      <b>{level}</b><small>{difficultyLabels[level]}</small>
                    </button>
                  ))}
                </div>
              </section>

              <section>
                <label className="detail-setting-heading" htmlFor="topic-select">
                  <b>開始するお題</b><span>TOPIC</span>
                </label>
                <select
                  id="topic-select"
                  value={game.room.selectedTopic ?? ""}
                  disabled={busy || !you?.isHost}
                  onChange={(event) => void run(() =>
                    updateRoomSettings({
                      selectedTopic: event.target.value || null,
                    })
                  )}
                >
                  <option value="">自動で選ぶ（ランダム）</option>
                  {game.room.availableTopics.map((topic) => (
                    <option key={topic} value={topic}>{topic}</option>
                  ))}
                </select>
              </section>

              {game.room.mode === "normal" ? (
                <>
                  <section>
                    <div className="detail-setting-heading">
                      <b>1回答の制限時間</b><span>TIME LIMIT</span>
                    </div>
                    <div className="detail-choice-grid three">
                      {[10, 15, 20].map((value) => (
                        <button
                          key={value}
                          className={game.room.timeLimit === value ? "selected" : ""}
                          disabled={busy || !you?.isHost}
                          onClick={() => void run(() =>
                            updateRoomSettings({ timeLimit: value })
                          )}
                          aria-pressed={game.room.timeLimit === value}
                        >
                          {value}秒
                        </button>
                      ))}
                    </div>
                  </section>

                  <section>
                    <div className="detail-setting-heading">
                      <b>お題の切り替え</b><span>TOPIC CHANGE</span>
                    </div>
                    <div className="detail-choice-grid three">
                      {([
                        ["none", "切り替えなし"],
                        ["rounds", "何周かごと"],
                        ["miss", "誰かが間違えるごと"],
                      ] as const).map(([value, label]) => (
                        <button
                          key={value}
                          className={game.room.topicSwitchMode === value ? "selected" : ""}
                          disabled={busy || !you?.isHost}
                          onClick={() => void run(() =>
                            updateRoomSettings({ topicSwitchMode: value })
                          )}
                          aria-pressed={game.room.topicSwitchMode === value}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    {game.room.topicSwitchMode === "rounds" && (
                      <div className="nested-setting">
                        <span>切り替える間隔</span>
                        <div className="detail-choice-grid three">
                          {[2, 3, 5].map((value) => (
                            <button
                              key={value}
                              className={game.room.topicSwitchRounds === value ? "selected" : ""}
                              disabled={busy || !you?.isHost}
                              onClick={() => void run(() =>
                                updateRoomSettings({ topicSwitchRounds: value })
                              )}
                              aria-pressed={game.room.topicSwitchRounds === value}
                            >
                              {value}周ごと
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </section>

                  <section>
                    <div className="detail-setting-heading">
                      <b>ライフ</b><span>LIFE</span>
                    </div>
                    <button
                      className={`life-toggle ${game.room.lifeEnabled ? "selected" : ""}`}
                      disabled={busy || !you?.isHost}
                      onClick={() => void run(() =>
                        updateRoomSettings({ lifeEnabled: !game.room.lifeEnabled })
                      )}
                      aria-pressed={game.room.lifeEnabled}
                    >
                      <span>{game.room.lifeEnabled ? "♥ ライフ ON" : "♡ ライフ OFF"}</span>
                      <small>間違いや時間切れで1つ減ります</small>
                    </button>
                    {game.room.lifeEnabled && (
                      <div className="nested-setting">
                        <span>ライフの数</span>
                        <div className="detail-choice-grid four">
                          {[2, 3, 5].map((value) => (
                            <button
                              key={value}
                              className={game.room.lifeCount === value ? "selected" : ""}
                              disabled={busy || !you?.isHost}
                              onClick={() => void run(() =>
                                updateRoomSettings({ lifeCount: value })
                              )}
                              aria-pressed={game.room.lifeCount === value}
                            >
                              ♥ × {value}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </section>
                </>
              ) : (
                <section className="bomb-settings">
                  <div className="detail-setting-heading">
                    <b>爆弾が爆発するまで</b><span>BOMB TIMER</span>
                  </div>
                  <div className="detail-choice-grid three">
                    {([
                      [60, "1分"],
                      [180, "3分"],
                      [300, "5分"],
                    ] as const).map(([value, label]) => (
                      <button
                        key={value}
                        className={game.room.bombDuration === value ? "selected bomb" : "bomb"}
                        disabled={busy || !you?.isHost}
                        onClick={() => void run(() =>
                          updateRoomSettings({ bombDuration: value })
                        )}
                        aria-pressed={game.room.bombDuration === value}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <div className="nested-setting bomb-topic-switch">
                    <span>30秒で別のお題に切り替える</span>
                    <button
                      className={`life-toggle ${game.room.bombTopicSwitchEnabled ? "selected" : ""}`}
                      disabled={busy || !you?.isHost}
                      onClick={() => void run(() =>
                        updateRoomSettings({
                          bombTopicSwitchEnabled:
                            !game.room.bombTopicSwitchEnabled,
                        })
                      )}
                      aria-pressed={game.room.bombTopicSwitchEnabled}
                    >
                      <span>
                        {game.room.bombTopicSwitchEnabled
                          ? "お題切り替え ON"
                          : "お題切り替え OFF"}
                      </span>
                      <small>
                        {game.room.bombTopicSwitchEnabled
                          ? "30秒答えられないと、別のお題へ切り替わります"
                          : "爆発するまで同じお題を続けます"}
                      </small>
                    </button>
                  </div>
                  <p>
                    爆弾の残り時間が5秒以下で次の人へ渡った場合も、
                    受け取った人には5秒の回答時間が保証されます。
                  </p>
                </section>
              )}
            </div>
            {error && <p className="form-error" role="alert">⚠ {error}</p>}
            <button className="primary-action" onClick={() => setScreen("room")}>
              <span>待機画面に戻る</span><b>←</b>
            </button>
          </div>
        </section>
      )}

      {screen === "room" && game?.room.status === "active" && (
        <section className="game-screen">
          <div className="game-meta">
            <button className="compact-code" onClick={() => void copyRoomCode()}>
              ROOM {game.room.code} ⧉
            </button>
            <span>ROUND {String(game.room.round).padStart(2, "0")}</span>
            <span className={`difficulty-chip level-${game.room.difficulty.toLowerCase()}`}>
              LEVEL {game.room.difficulty}
            </span>
            <span className={`mode-pill ${game.room.mode}`}>
              {game.room.mode === "bomb" ? "💣 BOMB MODE" : "⚡ NORMAL MODE"}
            </span>
            <button className="game-leave" onClick={() => void leaveRoom()}>退出</button>
          </div>
          {game.room.mode === "bomb" && (
            <div
              className={`bomb-clock ${bombSeconds <= 10 ? "danger" : ""}`}
              role="timer"
              aria-label={`爆発まで${formatElapsed(bombSeconds)}`}
            >
              <span aria-hidden="true">💣</span>
              <small>爆発まで</small>
              <b>{formatElapsed(bombSeconds)}</b>
              <em>答えると次の人へ。爆発時に持っていた人が脱落</em>
            </div>
          )}
          <div className="topic-board">
            <span>今回のお題</span>
            <h2>{game.room.topic}</h2>
            <p>
              {game.room.isCompletable && game.room.totalAnswers
                ? `全${game.room.totalAnswers}回答・残り${game.room.totalAnswers - game.room.answerCount}`
                : "自由回答・同じ答えは使えません"}
            </p>
          </div>
          <div className="battle-layout">
            <div className="turn-panel">
              <div className="turn-status">
                <span className="avatar avatar-big">
                  {avatars[Math.max(0, game.players.findIndex((player) => player.id === current?.id)) % avatars.length]}
                </span>
                <div>
                  <small>{game.room.mode === "bomb" ? "BOMB HOLDER" : "NEXT ANSWER"}</small>
                  <h3>{isYourTurn ? "あなたの番！" : `${current?.name ?? "…"} の番`}</h3>
                  {game.room.mode === "normal" && game.room.lifeEnabled && current && (
                    <p className="current-life">♥ × {current.lives}</p>
                  )}
                </div>
                {(game.room.mode !== "bomb" ||
                  game.room.bombTopicSwitchEnabled) && (
                  <div className={`countdown ${remaining < 3000 ? "danger" : ""}`} aria-live="off">
                    <b>{seconds}</b>
                    <small>{game.room.mode === "bomb" ? "お題切替" : "SEC"}</small>
                  </div>
                )}
              </div>
              {(game.room.mode !== "bomb" ||
                game.room.bombTopicSwitchEnabled) && (
                <div
                  className="timer-track"
                  aria-label={
                    game.room.mode === "bomb"
                      ? `お題切り替えまで残り${seconds}秒`
                      : `残り${seconds}秒`
                  }
                >
                  <i style={{ width: `${timerPercent}%` }} />
                </div>
              )}
              {you?.isAlive ? (
                <form className="answer-form" onSubmit={submitAnswer}>
                  <label className="sr-only" htmlFor="answer-input">回答</label>
                  <input
                    id="answer-input"
                    ref={answerRef}
                    value={answer}
                    onChange={(event) => setAnswer(event.target.value.slice(0, 30))}
                    placeholder={isYourTurn ? "答えを入力…" : "順番を待っています"}
                    disabled={!isYourTurn || busy}
                    maxLength={30}
                    autoComplete="off"
                  />
                  <button disabled={!isYourTurn || busy || !answer.trim()}>
                    回答する <b>↵</b>
                  </button>
                </form>
              ) : (
                <div className="spectating">観戦中 — 勝負の行方を見届けよう</div>
              )}
              {error && <p className="game-error" role="alert">⚠ {error}</p>}
              <div className="answer-history">
                <span>RECENT ANSWERS</span>
                <div>
                  {game.answers.length ? game.answers.slice(0, 8).map((item) => (
                    <p key={`${item.created_at}-${item.round}`}>
                      <b>{item.value}</b><small>{item.name}</small>
                    </p>
                  )) : <em>最初の答えを待っています</em>}
                </div>
              </div>
            </div>
            <aside className="standings">
              <div className="section-title">
                <span>SURVIVORS</span><b>{game.players.filter((player) => player.isAlive).length}</b>
              </div>
              {ranking.map((player, index) => (
                <div
                  className={`standing-player ${!player.isAlive ? "eliminated" : ""} ${player.id === current?.id ? "current" : ""}`}
                  key={player.id}
                >
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <i className={`avatar avatar-${index % 4}`}>
                    {avatars[game.players.findIndex((item) => item.id === player.id) % avatars.length]}
                  </i>
                  <b>
                    {player.name}{player.isYou && <small> YOU</small>}
                    {!player.isConnected && <small className="offline-label"> 再接続中</small>}
                  </b>
                  <em>
                    {player.isAlive
                      ? game.room.mode === "normal" && game.room.lifeEnabled
                        ? `♥ ${player.lives} · ${player.score} PT`
                        : `${player.score} PT`
                      : "OUT"}
                  </em>
                </div>
              ))}
            </aside>
          </div>
        </section>
      )}

      {screen === "room" && game?.room.status === "finished" && (
        <section className="result-screen">
          <div className="confetti c1" aria-hidden="true">●</div>
          <div className="confetti c2" aria-hidden="true">◆</div>
          <div className="result-summary">
            {game.room.finishReason === "completed" ? (
              <>
                <div className="result-kicker">MISSION COMPLETE</div>
                <div className="winner-avatar group-win" aria-hidden="true">🎊</div>
                <h2>全員クリア！</h2>
                <p>
                  <strong>{game.room.topic}</strong>を全部言い切った！<br />
                  最後まで残ったみんなの勝利です。
                </p>
              </>
            ) : (
              <>
                <div className="result-kicker">WE HAVE A WINNER</div>
                <div className="winner-avatar" aria-hidden="true">
                  👑<span>{avatars[Math.max(0, game.players.findIndex((player) => player.id === game.room.winnerId)) % avatars.length]}</span>
                </div>
                <h2>{game.players.find((player) => player.id === game.room.winnerId)?.name ?? "WINNER"}</h2>
                <p>最後まで言い切った！<br /><strong>山手線ゲーム王</strong>の誕生です。</p>
              </>
            )}
            <button className="share-result" onClick={() => void shareResult()}>
              結果を共有 ↗
            </button>
          </div>

          <div className="result-details">
            <div className="result-card">
              <div className="section-title"><span>FINAL RANKING</span><b>{game.players.length}人</b></div>
              <div className="result-ranking">
                {ranking.map((player, index) => (
                  <div key={player.id}>
                    <strong>{index + 1}</strong>
                    <span>{avatars[game.players.findIndex((item) => item.id === player.id) % avatars.length]}</span>
                    <b>{player.name}</b>
                    <em>{player.score}回答</em>
                  </div>
                ))}
              </div>
            </div>
            <div className="result-card">
              <div className="section-title"><span>ELIMINATION</span><b>脱落順</b></div>
              <ol className="elimination-list">
                {eliminatedPlayers.length ? eliminatedPlayers.map((player) => (
                  <li key={player.id}><b>{player.name}</b><span>{player.score}回答</span></li>
                )) : <li>全員クリアのため脱落者はいません</li>}
              </ol>
            </div>
            <div className="result-card answers-result">
              <div className="section-title"><span>ALL ANSWERS</span><b>{game.answers.length}</b></div>
              <div>
                {game.answers.length ? game.answers.map((item) => (
                  <p key={`${item.created_at}-${item.round}`}>
                    <small>{String(item.round).padStart(2, "0")}</small>
                    <b>{item.value}</b>
                    <span>{item.name}</span>
                  </p>
                )) : <em>回答はありませんでした</em>}
              </div>
            </div>
          </div>

          <div className="result-actions">
            <button
              className="primary-action"
              disabled={busy || !you?.isHost}
              onClick={() => void run(rematch)}
            >
              <span>{you?.isHost ? "同じメンバーでもう一度遊ぶ" : "ホストの再戦を待っています"}</span><b>↻</b>
            </button>
            <button className="secondary-action" onClick={goHome}>設定を変えて再戦</button>
            <button className="text-action" onClick={goHome}>トップへ戻る</button>
          </div>
          {error && <p className="form-error" role="alert">⚠ {error}</p>}
        </section>
      )}

      <footer>
        <span>山手線ゲームオンライン™</span>
        <nav aria-label="フッターナビゲーション">
          <a href="/terms">利用規約</a>
          <a href="/privacy">プライバシー</a>
          <a href="/contact">お問い合わせ</a>
        </nav>
        <span>言って、つないで、生き残れ。</span>
      </footer>

      {toast && <div className="toast" role="status">{toast}</div>}

      {rulesOpen && (
        <dialog
          open
          className="modal"
          aria-labelledby="rules-title"
          onCancel={(event) => {
            event.preventDefault();
            setRulesOpen(false);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              setRulesOpen(false);
            }
          }}
        >
          <button
            className="modal-close"
            onClick={() => setRulesOpen(false)}
            aria-label="遊び方を閉じる"
            autoFocus
          >
            ×
          </button>
          <span className="step-label">HOW TO PLAY</span>
          <h2 id="rules-title">遊び方</h2>
          <ol>
            <li><b>文字で回答</b><span>自分の番に、お題に合う回答を入力して送信します。</span></li>
            <li><b>正誤判定</b><span>登録済み回答があるお題は自動判定。自由回答は入力を受理し、迷う場合は参加者同士で確認します。</span></li>
            <li><b>重複と表記揺れ</b><span>同じ回答は使用不可。ひらがな・カタカナや登録済みの漢字表記は同じ回答として扱います。</span></li>
            <li><b>誤字</b><span>自動判定のお題では不正解になります。自由回答では自動で意味までは判定できません。</span></li>
            <li>
              <b>通常モード</b>
              <span>
                設定時間を超えるか自動判定で間違えると脱落します。
                ライフをONにした場合は、ライフが0になるまで続けられます。
              </span>
            </li>
            <li>
              <b>爆弾モード</b>
              <span>
                答えると爆弾が次の人へ移り、爆発時の所持者が脱落します。
                30秒でのお題切り替えは、友達ルームの設定でOFFにもできます。
                残り5秒以下で受け取った場合も、5秒間は回答できます。
              </span>
            </li>
            <li><b>ランダムマッチ</b><span>通常モード・1回答15秒固定です。</span></li>
          </ol>
          <p>回答候補をすべて言い切れるお題では、その時点で残っている全員が勝利します。</p>
        </dialog>
      )}

      {leaveConfirmOpen && (
        <dialog
          open
          className="modal confirm-modal"
          aria-labelledby="leave-confirm-title"
          aria-describedby="leave-confirm-description"
          onCancel={(event) => {
            event.preventDefault();
            setLeaveConfirmOpen(false);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              setLeaveConfirmOpen(false);
            }
          }}
        >
          <span className="step-label">LEAVE ROOM</span>
          <h2 id="leave-confirm-title">ルームから退出しますか？</h2>
          <p id="leave-confirm-description">待機中のルームから退出して、トップ画面へ戻ります。</p>
          <div className="confirm-actions">
            <button
              className="secondary-action"
              onClick={() => setLeaveConfirmOpen(false)}
              autoFocus
            >
              キャンセル
            </button>
            <button
              className="danger-action"
              disabled={busy}
              onClick={() => void run(async () => {
                setLeaveConfirmOpen(false);
                await leaveRoom();
              })}
            >
              退出する
            </button>
          </div>
        </dialog>
      )}

    </main>
  );
}
