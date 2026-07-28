import { env } from "cloudflare:workers";
import { NextRequest, NextResponse } from "next/server";
import { topicByName, topicsForDifficulty } from "./topics";

type Room = {
  code: string;
  status: "lobby" | "active" | "finished";
  topic: string | null;
  time_limit: number;
  difficulty: "S" | "A" | "B" | "C";
  current_turn: string | null;
  turn_started_at: number | null;
  winner_id: string | null;
  finish_reason: "completed" | "last_survivor" | null;
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

type MatchEntry = {
  player_id: string;
  name: string;
  difficulty: "S" | "A" | "B" | "C";
  time_limit: number;
  status: "waiting" | "claiming" | "matched";
  room_code: string | null;
  queued_at: number;
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
      time_limit INTEGER NOT NULL DEFAULT 10, difficulty TEXT NOT NULL DEFAULT 'C',
      current_turn TEXT, turn_started_at INTEGER, winner_id TEXT,
      finish_reason TEXT, round INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
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
    database.prepare(`CREATE TABLE IF NOT EXISTS matchmaking_queue (
      player_id TEXT PRIMARY KEY, name TEXT NOT NULL, difficulty TEXT NOT NULL,
      time_limit INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'waiting',
      room_code TEXT, queued_at INTEGER NOT NULL
    )`),
    database.prepare(
      "CREATE INDEX IF NOT EXISTS matchmaking_search_idx ON matchmaking_queue(status, difficulty, time_limit, queued_at)",
    ),
  ]);

  const columns = await database
    .prepare("PRAGMA table_info(rooms)")
    .all<{ name: string }>();
  const names = new Set(columns.results.map((column) => column.name));
  if (!names.has("difficulty")) {
    await database.prepare(
      "ALTER TABLE rooms ADD COLUMN difficulty TEXT NOT NULL DEFAULT 'C'",
    ).run();
  }
  if (!names.has("finish_reason")) {
    await database.prepare(
      "ALTER TABLE rooms ADD COLUMN finish_reason TEXT",
    ).run();
  }
}

function normalize(value: string, topic?: string | null) {
  let result = value
    .trim()
    .toLocaleLowerCase("ja")
    .replace(/[ 　・･。、,.\-ー]/g, "");
  if (topic === "山手線の駅") result = result.replace(/駅$/, "");
  if (topic === "都道府県") result = result.replace(/[都道府県]$/, "");
  if (topic === "東京23区") result = result.replace(/区$/, "");
  if (topic === "政令指定都市") result = result.replace(/市$/, "");
  if (topic === "アメリカの州") result = result.replace(/州$/, "");
  if (topic === "県庁所在地") result = result.replace(/[市区]$/, "");
  if (topic === "国" || topic === "EU加盟国" || topic === "赤道が通る国") {
    const aliases: Record<string, string> = {
      アメリカ合衆国: "アメリカ",
      米国: "アメリカ",
      英国: "イギリス",
      大韓民国: "韓国",
      中華人民共和国: "中国",
      ロシア連邦: "ロシア",
      バチカン市国: "バチカン",
      チェコ共和国: "チェコ",
    };
    result = aliases[result] ?? result;
  }
  return result;
}

function accepted(topic: string, value: string) {
  const config = topicByName(topic);
  if (!config?.answers) return true;
  return config.answers.some(
    (candidate) => normalize(candidate, topic) === normalize(value, topic),
  );
}

function cleanName(value: unknown) {
  return String(value ?? "").trim().replace(/\s+/g, " ").slice(0, 12);
}

function cleanCode(value: unknown) {
  return String(value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 5);
}

function cleanTimeLimit(value: unknown) {
  const candidate = Number(value);
  return [10, 15, 20].includes(candidate) ? candidate : 10;
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
          "UPDATE rooms SET status = 'finished', winner_id = ?, finish_reason = 'last_survivor', current_turn = NULL WHERE code = ? AND current_turn = ? AND turn_started_at = ?",
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
  const answerCount = await db()
    .prepare("SELECT COUNT(*) AS count FROM answers WHERE room_code = ?")
    .bind(code)
    .first<{ count: number }>();
  const topic = topicByName(room.topic);

  return {
    room: {
      code: room.code,
      status: room.status,
      topic: room.topic,
      difficulty: room.difficulty,
      timeLimit: room.time_limit,
      currentTurn: room.current_turn,
      deadline:
        room.status === "active" && room.turn_started_at
          ? room.turn_started_at + room.time_limit * 1000
          : null,
      winnerId: room.winner_id,
      finishReason: room.finish_reason,
      isCompletable: Boolean(topic?.completable),
      totalAnswers: topic?.completable ? topic.answers?.length ?? null : null,
      answerCount: answerCount?.count ?? 0,
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

async function getMatchEntry(playerId: string) {
  return (await db()
    .prepare("SELECT * FROM matchmaking_queue WHERE player_id = ?")
    .bind(playerId)
    .first<MatchEntry>()) ?? null;
}

async function waitingResponse(playerId: string) {
  const entry = await getMatchEntry(playerId);
  if (!entry || entry.status !== "waiting") {
    throw new Error("マッチング待機が終了しました");
  }
  return {
    matchmaking: {
      status: "waiting",
      difficulty: entry.difficulty,
      timeLimit: entry.time_limit,
      queuedAt: entry.queued_at,
    },
    playerId,
  };
}

async function attemptRandomMatch(playerId: string) {
  const self = await getMatchEntry(playerId);
  if (!self) throw new Error("マッチング情報が見つかりません");
  if (self.status === "matched" && self.room_code) {
    return { ...(await state(self.room_code, playerId)), playerId };
  }
  if (self.status !== "waiting") return waitingResponse(playerId);

  const pairResult = await db()
    .prepare(
      `SELECT * FROM matchmaking_queue
       WHERE status = 'waiting' AND difficulty = ? AND time_limit = ?
       ORDER BY queued_at, player_id LIMIT 2`,
    )
    .bind(self.difficulty, self.time_limit)
    .all<MatchEntry>();
  const pair = pairResult.results;
  if (pair.length < 2 || pair[1].player_id !== playerId) {
    return waitingResponse(playerId);
  }

  const opponent = pair[0];
  const claims = await db().batch([
    db()
      .prepare(
        "UPDATE matchmaking_queue SET status = 'claiming' WHERE player_id = ? AND status = 'waiting'",
      )
      .bind(opponent.player_id),
    db()
      .prepare(
        "UPDATE matchmaking_queue SET status = 'claiming' WHERE player_id = ? AND status = 'waiting'",
      )
      .bind(self.player_id),
  ]);
  if (
    Number(claims[0].meta.changes ?? 0) !== 1 ||
    Number(claims[1].meta.changes ?? 0) !== 1
  ) {
    await db()
      .prepare(
        "UPDATE matchmaking_queue SET status = 'waiting' WHERE player_id IN (?, ?) AND status = 'claiming'",
      )
      .bind(opponent.player_id, self.player_id)
      .run();
    return waitingResponse(playerId);
  }

  let code = roomCode();
  while (await getRoom(code)) code = roomCode();
  const candidates = topicsForDifficulty(self.difficulty);
  const topic = candidates[Math.floor(Math.random() * candidates.length)];
  if (!topic) throw new Error("お題が見つかりません");
  const now = Date.now();

  await db().batch([
    db()
      .prepare(
        `INSERT INTO rooms
         (code, status, topic, time_limit, difficulty, current_turn, turn_started_at, round, created_at)
         VALUES (?, 'active', ?, ?, ?, ?, ?, 1, ?)`,
      )
      .bind(
        code,
        topic.name,
        self.time_limit,
        self.difficulty,
        opponent.player_id,
        now,
        now,
      ),
    db()
      .prepare(
        "INSERT INTO players (id, room_code, name, is_host, is_alive, score, joined_at) VALUES (?, ?, ?, 1, 1, 0, ?)",
      )
      .bind(opponent.player_id, code, opponent.name, opponent.queued_at),
    db()
      .prepare(
        "INSERT INTO players (id, room_code, name, is_host, is_alive, score, joined_at) VALUES (?, ?, ?, 0, 1, 0, ?)",
      )
      .bind(self.player_id, code, self.name, self.queued_at),
    db()
      .prepare(
        "UPDATE matchmaking_queue SET status = 'matched', room_code = ? WHERE player_id IN (?, ?)",
      )
      .bind(code, opponent.player_id, self.player_id),
  ]);

  return { ...(await state(code, playerId)), playerId };
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

    if (action === "matchmake") {
      const name = cleanName(body.name);
      if (!name) throw new Error("名前を入力してください");
      const requestedDifficulty = String(body.difficulty ?? "C").toUpperCase();
      const difficulty = ["S", "A", "B", "C"].includes(requestedDifficulty)
        ? requestedDifficulty
        : "C";
      const timeLimit = cleanTimeLimit(body.timeLimit);

      await db()
        .prepare(
          "DELETE FROM matchmaking_queue WHERE status = 'waiting' AND queued_at < ?",
        )
        .bind(now - 10 * 60 * 1000)
        .run();
      const existing = await getMatchEntry(playerId);
      if (existing?.status === "matched" && existing.room_code) {
        return NextResponse.json({
          ...(await state(existing.room_code, playerId)),
          playerId,
        });
      }
      await db()
        .prepare(
          `INSERT INTO matchmaking_queue
           (player_id, name, difficulty, time_limit, status, room_code, queued_at)
           VALUES (?, ?, ?, ?, 'waiting', NULL, ?)
           ON CONFLICT(player_id) DO UPDATE SET
             name = excluded.name, difficulty = excluded.difficulty,
             time_limit = excluded.time_limit, status = 'waiting',
             room_code = NULL, queued_at = excluded.queued_at`,
        )
        .bind(playerId, name, difficulty, timeLimit, now)
        .run();
      return NextResponse.json(await attemptRandomMatch(playerId));
    }

    if (action === "match_status") {
      return NextResponse.json(await attemptRandomMatch(playerId));
    }

    if (action === "cancel_match") {
      await db()
        .prepare(
          "DELETE FROM matchmaking_queue WHERE player_id = ? AND status IN ('waiting', 'claiming')",
        )
        .bind(playerId)
        .run();
      return NextResponse.json({ matchmaking: { status: "cancelled" } });
    }

    if (action === "create") {
      const name = cleanName(body.name);
      if (!name) throw new Error("名前を入力してください");
      const timeLimit = cleanTimeLimit(body.timeLimit);
      const requestedDifficulty = String(body.difficulty ?? "C").toUpperCase();
      const difficulty = ["S", "A", "B", "C"].includes(requestedDifficulty)
        ? requestedDifficulty
        : "C";
      let code = roomCode();
      while (await getRoom(code)) code = roomCode();
      await db().batch([
        db()
          .prepare(
            "INSERT INTO rooms (code, status, time_limit, difficulty, round, created_at) VALUES (?, 'lobby', ?, ?, 0, ?)",
          )
          .bind(code, timeLimit, difficulty, now),
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
      const candidates = topicsForDifficulty(room.difficulty);
      const topic = candidates[Math.floor(Math.random() * candidates.length)];
      if (!topic) throw new Error("お題が見つかりません");
      await db()
        .prepare(
          "UPDATE rooms SET status = 'active', topic = ?, current_turn = ?, turn_started_at = ?, round = 1 WHERE code = ? AND status = 'lobby'",
        )
        .bind(topic.name, players[0].id, now, code)
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
      const topic = topicByName(freshRoom.topic);
      const count = await db()
        .prepare("SELECT COUNT(*) AS count FROM answers WHERE room_code = ?")
        .bind(code)
        .first<{ count: number }>();
      const completesTopic = Boolean(
        topic?.completable &&
        topic.answers &&
        (count?.count ?? 0) + 1 >= topic.answers.length,
      );
      const operations = [
        db()
          .prepare(
            "INSERT INTO answers (id, room_code, player_id, value, normalized, round, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
          )
          .bind(crypto.randomUUID(), code, playerId, value, normalized, freshRoom.round, now),
        db().prepare("UPDATE players SET score = score + 1 WHERE id = ?").bind(playerId),
        completesTopic
          ? db()
            .prepare(
              "UPDATE rooms SET status = 'finished', finish_reason = 'completed', winner_id = NULL, current_turn = NULL WHERE code = ? AND current_turn = ?",
            )
            .bind(code, playerId)
          : db()
          .prepare(
            "UPDATE rooms SET current_turn = ?, turn_started_at = ?, round = round + 1 WHERE code = ? AND current_turn = ?",
          )
          .bind(next.id, now, code, playerId),
      ];
      await db().batch(operations);
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
