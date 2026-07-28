import { env } from "cloudflare:workers";
import { NextRequest, NextResponse } from "next/server";

type Room = {
  code: string;
  status: "lobby" | "active" | "finished";
  topic: string | null;
  time_limit: number;
  current_turn: string | null;
  turn_started_at: number | null;
  winner_id: string | null;
  round: number;
};

type Player = {
  id: string;
  room_code: string;
  name: string;
  is_host: number;
  is_alive: number;
  score: number;
  joined_at: number;
};

const TOPICS: Record<string, string[]> = {
  "山手線の駅": [
    "東京", "神田", "秋葉原", "御徒町", "上野", "鶯谷", "日暮里", "西日暮里",
    "田端", "駒込", "巣鴨", "大塚", "池袋", "目白", "高田馬場", "新大久保",
    "新宿", "代々木", "原宿", "渋谷", "恵比寿", "目黒", "五反田", "大崎",
    "品川", "高輪ゲートウェイ", "田町", "浜松町", "新橋", "有楽町",
  ],
  "日本の都道府県": [
    "北海道", "青森県", "岩手県", "宮城県", "秋田県", "山形県", "福島県",
    "茨城県", "栃木県", "群馬県", "埼玉県", "千葉県", "東京都", "神奈川県",
    "新潟県", "富山県", "石川県", "福井県", "山梨県", "長野県", "岐阜県",
    "静岡県", "愛知県", "三重県", "滋賀県", "京都府", "大阪府", "兵庫県",
    "奈良県", "和歌山県", "鳥取県", "島根県", "岡山県", "広島県", "山口県",
    "徳島県", "香川県", "愛媛県", "高知県", "福岡県", "佐賀県", "長崎県",
    "熊本県", "大分県", "宮崎県", "鹿児島県", "沖縄県",
  ],
  "動物の名前": [
    "犬", "猫", "うさぎ", "パンダ", "ライオン", "トラ", "ゾウ", "キリン",
    "ゴリラ", "チンパンジー", "コアラ", "カンガルー", "シマウマ", "カバ",
    "サイ", "ワニ", "ヘビ", "カメ", "ペンギン", "アザラシ", "イルカ",
    "クジラ", "サメ", "ラッコ", "カワウソ", "リス", "ハムスター", "キツネ",
    "たぬき", "オオカミ", "くま", "鹿", "猿", "馬", "牛", "豚", "羊",
    "ヤギ", "ラクダ", "ナマケモノ", "アルパカ", "カピバラ", "ハリネズミ",
    "モグラ", "コウモリ", "フクロウ", "鷹", "鶴", "孔雀",
  ],
  "くだもの": [
    "りんご", "みかん", "バナナ", "ぶどう", "いちご", "メロン", "すいか",
    "桃", "梨", "柿", "さくらんぼ", "レモン", "ライム", "オレンジ",
    "グレープフルーツ", "キウイ", "マンゴー", "パイナップル", "パパイヤ",
    "アボカド", "ブルーベリー", "ラズベリー", "ざくろ", "いちじく",
    "びわ", "あんず", "梅", "栗", "ドラゴンフルーツ", "パッションフルーツ",
  ],
};

function db() {
  if (!env.DB) throw new Error("Database is unavailable");
  return env.DB;
}

async function ensureSchema() {
  const database = db();
  await database.batch([
    database.prepare(`CREATE TABLE IF NOT EXISTS rooms (
      code TEXT PRIMARY KEY, status TEXT NOT NULL DEFAULT 'lobby', topic TEXT,
      time_limit INTEGER NOT NULL DEFAULT 10, current_turn TEXT,
      turn_started_at INTEGER, winner_id TEXT, round INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    )`),
    database.prepare(`CREATE TABLE IF NOT EXISTS players (
      id TEXT PRIMARY KEY, room_code TEXT NOT NULL, name TEXT NOT NULL,
      is_host INTEGER NOT NULL DEFAULT 0, is_alive INTEGER NOT NULL DEFAULT 1,
      score INTEGER NOT NULL DEFAULT 0, joined_at INTEGER NOT NULL
    )`),
    database.prepare(
      "CREATE UNIQUE INDEX IF NOT EXISTS players_room_name_idx ON players(room_code, name)",
    ),
    database.prepare(`CREATE TABLE IF NOT EXISTS answers (
      id TEXT PRIMARY KEY, room_code TEXT NOT NULL, player_id TEXT NOT NULL,
      value TEXT NOT NULL, normalized TEXT NOT NULL, round INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    )`),
    database.prepare(
      "CREATE UNIQUE INDEX IF NOT EXISTS answers_room_normalized_idx ON answers(room_code, normalized)",
    ),
  ]);
}

function normalize(value: string, topic?: string | null) {
  let result = value
    .trim()
    .toLocaleLowerCase("ja")
    .replace(/[ 　・･。、,.\-ー]/g, "");
  if (topic === "山手線の駅") result = result.replace(/駅$/, "");
  if (topic === "日本の都道府県") result = result.replace(/[都道府県]$/, "");
  return result;
}

function accepted(topic: string, value: string) {
  return (TOPICS[topic] ?? []).some(
    (candidate) => normalize(candidate, topic) === normalize(value, topic),
  );
}

function cleanName(value: unknown) {
  return String(value ?? "").trim().replace(/\s+/g, " ").slice(0, 12);
}

function cleanCode(value: unknown) {
  return String(value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 5);
}

async function getRoom(code: string) {
  return (await db()
    .prepare("SELECT * FROM rooms WHERE code = ?")
    .bind(code)
    .first<Room>()) ?? null;
}

async function getPlayers(code: string) {
  const result = await db()
    .prepare("SELECT * FROM players WHERE room_code = ? ORDER BY joined_at, id")
    .bind(code)
    .all<Player>();
  return result.results;
}

function nextPlayer(players: Player[], currentId: string) {
  const start = Math.max(0, players.findIndex((player) => player.id === currentId));
  for (let offset = 1; offset <= players.length; offset += 1) {
    const candidate = players[(start + offset) % players.length];
    if (candidate?.is_alive && candidate.id !== currentId) return candidate;
  }
  return players.find((player) => player.is_alive && player.id !== currentId);
}

async function eliminateTimedOutPlayer(room: Room) {
  if (
    room.status !== "active" ||
    !room.current_turn ||
    !room.turn_started_at ||
    Date.now() - room.turn_started_at < room.time_limit * 1000
  ) return;

  const players = await getPlayers(room.code);
  const remaining = players.filter(
    (player) => player.is_alive && player.id !== room.current_turn,
  );
  const now = Date.now();

  if (remaining.length <= 1) {
    await db().batch([
      db()
        .prepare(
          "UPDATE rooms SET status = 'finished', winner_id = ?, current_turn = NULL WHERE code = ? AND current_turn = ? AND turn_started_at = ?",
        )
        .bind(remaining[0]?.id ?? null, room.code, room.current_turn, room.turn_started_at),
      db()
        .prepare("UPDATE players SET is_alive = 0 WHERE id = ?")
        .bind(room.current_turn),
    ]);
    return;
  }

  const next = nextPlayer(players, room.current_turn);
  if (!next) return;
  await db().batch([
    db()
      .prepare(
        "UPDATE rooms SET current_turn = ?, turn_started_at = ?, round = round + 1 WHERE code = ? AND current_turn = ? AND turn_started_at = ?",
      )
      .bind(next.id, now, room.code, room.current_turn, room.turn_started_at),
    db()
      .prepare("UPDATE players SET is_alive = 0 WHERE id = ?")
      .bind(room.current_turn),
  ]);
}

async function state(code: string, playerId?: string) {
  let room = await getRoom(code);
  if (!room) throw new Error("ROOM_NOT_FOUND");
  await eliminateTimedOutPlayer(room);
  room = (await getRoom(code))!;
  const players = await getPlayers(code);
  const answerResult = await db()
    .prepare(
      `SELECT answers.value, answers.created_at, players.name
       FROM answers JOIN players ON players.id = answers.player_id
       WHERE answers.room_code = ? ORDER BY answers.created_at DESC LIMIT 8`,
    )
    .bind(code)
    .all<{ value: string; created_at: number; name: string }>();

  return {
    room: {
      code: room.code,
      status: room.status,
      topic: room.topic,
      timeLimit: room.time_limit,
      currentTurn: room.current_turn,
      deadline:
        room.status === "active" && room.turn_started_at
          ? room.turn_started_at + room.time_limit * 1000
          : null,
      winnerId: room.winner_id,
      round: room.round,
    },
    players: players.map((player) => ({
      id: player.id,
      name: player.name,
      isHost: Boolean(player.is_host),
      isAlive: Boolean(player.is_alive),
      score: player.score,
      isYou: player.id === playerId,
    })),
    answers: answerResult.results,
    serverNow: Date.now(),
  };
}

function roomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 5 }, () =>
    alphabet[Math.floor(Math.random() * alphabet.length)]
  ).join("");
}

export async function GET(request: NextRequest) {
  try {
    await ensureSchema();
    const code = cleanCode(request.nextUrl.searchParams.get("code"));
    const playerId = request.nextUrl.searchParams.get("playerId") ?? undefined;
    return NextResponse.json(await state(code, playerId));
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN";
    return NextResponse.json(
      { error: message === "ROOM_NOT_FOUND" ? "ルームが見つかりません" : "通信に失敗しました" },
      { status: message === "ROOM_NOT_FOUND" ? 404 : 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    await ensureSchema();
    const body = (await request.json()) as Record<string, unknown>;
    const action = String(body.action ?? "");
    const playerId = String(body.playerId ?? crypto.randomUUID());
    const now = Date.now();

    if (action === "create") {
      const name = cleanName(body.name);
      if (!name) throw new Error("名前を入力してください");
      const timeLimit = Math.min(30, Math.max(5, Number(body.timeLimit) || 10));
      let code = roomCode();
      while (await getRoom(code)) code = roomCode();
      await db().batch([
        db()
          .prepare(
            "INSERT INTO rooms (code, status, time_limit, round, created_at) VALUES (?, 'lobby', ?, 0, ?)",
          )
          .bind(code, timeLimit, now),
        db()
          .prepare(
            "INSERT INTO players (id, room_code, name, is_host, is_alive, score, joined_at) VALUES (?, ?, ?, 1, 1, 0, ?)",
          )
          .bind(playerId, code, name, now),
      ]);
      return NextResponse.json({ ...(await state(code, playerId)), playerId });
    }

    const code = cleanCode(body.code);
    const room = await getRoom(code);
    if (!room) throw new Error("ルームが見つかりません");

    if (action === "join") {
      const name = cleanName(body.name);
      if (!name) throw new Error("名前を入力してください");
      if (room.status !== "lobby") throw new Error("このゲームはすでに始まっています");
      const players = await getPlayers(code);
      if (players.length >= 8) throw new Error("このルームは満員です");
      await db()
        .prepare(
          "INSERT INTO players (id, room_code, name, is_host, is_alive, score, joined_at) VALUES (?, ?, ?, 0, 1, 0, ?)",
        )
        .bind(playerId, code, name, now)
        .run();
      return NextResponse.json({ ...(await state(code, playerId)), playerId });
    }

    if (action === "start") {
      const players = await getPlayers(code);
      const requester = players.find((player) => player.id === playerId);
      if (!requester?.is_host) throw new Error("ホストだけが開始できます");
      if (players.length < 2) throw new Error("2人以上そろうと開始できます");
      const topicNames = Object.keys(TOPICS);
      const topic = topicNames[Math.floor(Math.random() * topicNames.length)];
      await db()
        .prepare(
          "UPDATE rooms SET status = 'active', topic = ?, current_turn = ?, turn_started_at = ?, round = 1 WHERE code = ? AND status = 'lobby'",
        )
        .bind(topic, players[0].id, now, code)
        .run();
      return NextResponse.json(await state(code, playerId));
    }

    if (action === "answer") {
      await eliminateTimedOutPlayer(room);
      const freshRoom = await getRoom(code);
      if (!freshRoom || freshRoom.status !== "active") throw new Error("ゲームは終了しました");
      if (freshRoom.current_turn !== playerId) throw new Error("いまはあなたの番ではありません");
      const value = String(body.answer ?? "").trim().slice(0, 30);
      if (!value) throw new Error("答えを入力してください");
      if (!freshRoom.topic || !accepted(freshRoom.topic, value)) {
        throw new Error("その答えはお題に合っていないようです");
      }
      const normalized = normalize(value, freshRoom.topic);
      const duplicate = await db()
        .prepare("SELECT id FROM answers WHERE room_code = ? AND normalized = ?")
        .bind(code, normalized)
        .first();
      if (duplicate) throw new Error("その答えはもう出ています");
      const players = await getPlayers(code);
      const next = nextPlayer(players, playerId);
      if (!next) throw new Error("次のプレイヤーが見つかりません");
      await db().batch([
        db()
          .prepare(
            "INSERT INTO answers (id, room_code, player_id, value, normalized, round, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
          )
          .bind(crypto.randomUUID(), code, playerId, value, normalized, freshRoom.round, now),
        db().prepare("UPDATE players SET score = score + 1 WHERE id = ?").bind(playerId),
        db()
          .prepare(
            "UPDATE rooms SET current_turn = ?, turn_started_at = ?, round = round + 1 WHERE code = ? AND current_turn = ?",
          )
          .bind(next.id, now, code, playerId),
      ]);
      return NextResponse.json(await state(code, playerId));
    }

    throw new Error("操作を確認してください");
  } catch (error) {
    const raw = error instanceof Error ? error.message : "操作に失敗しました";
    const message = raw.includes("UNIQUE")
      ? "その名前はすでに使われています"
      : raw;
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
