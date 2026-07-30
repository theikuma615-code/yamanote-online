import { env } from "cloudflare:workers";
import { NextRequest, NextResponse } from "next/server";
import { normalizeAnswer } from "./answer-normalization";
import { canResumeRandomRoom } from "./matchmaking";
import { topicByName, topicsForDifficulty } from "./topics";

type Room = {
  code: string;
  status: "lobby" | "starting" | "active" | "finished";
  topic: string | null;
  time_limit: number;
  difficulty: "S" | "A" | "B" | "C";
  mode: "normal" | "bomb";
  topic_switch_mode: "none" | "rounds" | "miss";
  topic_switch_rounds: number;
  topic_changed_round: number;
  selected_topic: string | null;
  life_enabled: number;
  life_count: number;
  bomb_duration: number;
  bomb_topic_switch_enabled: number;
  bomb_started_at: number | null;
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
  eliminated_at: number | null;
  last_seen_at: number | null;
  lives: number;
};

type MatchEntry = {
  player_id: string;
  name: string;
  difficulty: "S" | "A" | "B" | "C";
  time_limit: number;
  status: "waiting" | "claiming" | "matched" | "ready";
  room_code: string | null;
  queued_at: number;
};

const randomMatchTimeLimit = 15;

function db() {
  if (!env.DB) throw new Error("Database is unavailable");
  return env.DB;
}

async function ensureSchema() {
  const database = db();
  await database.batch([
    database.prepare(`CREATE TABLE IF NOT EXISTS rooms (
      code TEXT PRIMARY KEY, status TEXT NOT NULL DEFAULT 'lobby', topic TEXT,
      time_limit INTEGER NOT NULL DEFAULT 15, difficulty TEXT NOT NULL DEFAULT 'C',
      mode TEXT NOT NULL DEFAULT 'normal',
      topic_switch_mode TEXT NOT NULL DEFAULT 'none',
      topic_switch_rounds INTEGER NOT NULL DEFAULT 1,
      topic_changed_round INTEGER NOT NULL DEFAULT 1,
      selected_topic TEXT, life_enabled INTEGER NOT NULL DEFAULT 0,
      life_count INTEGER NOT NULL DEFAULT 1,
      bomb_duration INTEGER NOT NULL DEFAULT 180,
      bomb_topic_switch_enabled INTEGER NOT NULL DEFAULT 1,
      bomb_started_at INTEGER,
      current_turn TEXT, turn_started_at INTEGER, winner_id TEXT,
      finish_reason TEXT, round INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
    )`),
    database.prepare(`CREATE TABLE IF NOT EXISTS players (
      id TEXT PRIMARY KEY, room_code TEXT NOT NULL, name TEXT NOT NULL,
      is_host INTEGER NOT NULL DEFAULT 0, is_alive INTEGER NOT NULL DEFAULT 1,
      score INTEGER NOT NULL DEFAULT 0, joined_at INTEGER NOT NULL,
      eliminated_at INTEGER, last_seen_at INTEGER, lives INTEGER NOT NULL DEFAULT 1
    )`),
    database.prepare(
      "CREATE UNIQUE INDEX IF NOT EXISTS players_room_name_idx ON players(room_code, name)",
    ),
    database.prepare(`CREATE TABLE IF NOT EXISTS answers (
      id TEXT PRIMARY KEY, room_code TEXT NOT NULL, player_id TEXT NOT NULL,
      topic TEXT NOT NULL DEFAULT '', value TEXT NOT NULL,
      normalized TEXT NOT NULL, round INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    )`),
    database.prepare(
      "CREATE UNIQUE INDEX IF NOT EXISTS answers_room_round_idx ON answers(room_code, round)",
    ),
    database.prepare(`CREATE TABLE IF NOT EXISTS matchmaking_queue (
      player_id TEXT PRIMARY KEY, name TEXT NOT NULL, difficulty TEXT NOT NULL,
      time_limit INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'waiting',
      room_code TEXT, queued_at INTEGER NOT NULL
    )`),
    database.prepare(
      "CREATE INDEX IF NOT EXISTS matchmaking_search_idx ON matchmaking_queue(status, difficulty, time_limit, queued_at)",
    ),
    database.prepare(`CREATE TABLE IF NOT EXISTS request_limits (
      key TEXT PRIMARY KEY, window_started_at INTEGER NOT NULL,
      count INTEGER NOT NULL DEFAULT 1
    )`),
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
  if (!names.has("mode")) {
    await database.prepare(
      "ALTER TABLE rooms ADD COLUMN mode TEXT NOT NULL DEFAULT 'normal'",
    ).run();
  }
  if (!names.has("topic_switch_mode")) {
    await database.prepare(
      "ALTER TABLE rooms ADD COLUMN topic_switch_mode TEXT NOT NULL DEFAULT 'none'",
    ).run();
  }
  if (!names.has("topic_switch_rounds")) {
    await database.prepare(
      "ALTER TABLE rooms ADD COLUMN topic_switch_rounds INTEGER NOT NULL DEFAULT 1",
    ).run();
  }
  if (!names.has("topic_changed_round")) {
    await database.prepare(
      "ALTER TABLE rooms ADD COLUMN topic_changed_round INTEGER NOT NULL DEFAULT 1",
    ).run();
  }
  if (!names.has("selected_topic")) {
    await database.prepare("ALTER TABLE rooms ADD COLUMN selected_topic TEXT").run();
  }
  if (!names.has("life_enabled")) {
    await database.prepare(
      "ALTER TABLE rooms ADD COLUMN life_enabled INTEGER NOT NULL DEFAULT 0",
    ).run();
  }
  if (!names.has("life_count")) {
    await database.prepare(
      "ALTER TABLE rooms ADD COLUMN life_count INTEGER NOT NULL DEFAULT 1",
    ).run();
  }
  if (!names.has("bomb_duration")) {
    await database.prepare(
      "ALTER TABLE rooms ADD COLUMN bomb_duration INTEGER NOT NULL DEFAULT 180",
    ).run();
  }
  if (!names.has("bomb_topic_switch_enabled")) {
    await database.prepare(
      "ALTER TABLE rooms ADD COLUMN bomb_topic_switch_enabled INTEGER NOT NULL DEFAULT 1",
    ).run();
  }
  if (!names.has("bomb_started_at")) {
    await database.prepare("ALTER TABLE rooms ADD COLUMN bomb_started_at INTEGER").run();
  }

  const playerColumns = await database
    .prepare("PRAGMA table_info(players)")
    .all<{ name: string }>();
  const playerNames = new Set(playerColumns.results.map((column) => column.name));
  if (!playerNames.has("eliminated_at")) {
    await database.prepare(
      "ALTER TABLE players ADD COLUMN eliminated_at INTEGER",
    ).run();
  }
  if (!playerNames.has("last_seen_at")) {
    await database.prepare(
      "ALTER TABLE players ADD COLUMN last_seen_at INTEGER",
    ).run();
  }
  if (!playerNames.has("lives")) {
    await database.prepare(
      "ALTER TABLE players ADD COLUMN lives INTEGER NOT NULL DEFAULT 1",
    ).run();
  }

  const answerColumns = await database
    .prepare("PRAGMA table_info(answers)")
    .all<{ name: string }>();
  const answerNames = new Set(answerColumns.results.map((column) => column.name));
  if (!answerNames.has("topic")) {
    await database.prepare(
      "ALTER TABLE answers ADD COLUMN topic TEXT NOT NULL DEFAULT ''",
    ).run();
  }
  await database.batch([
    database.prepare("DROP INDEX IF EXISTS answers_room_normalized_idx"),
    database.prepare(
      "CREATE UNIQUE INDEX IF NOT EXISTS answers_room_topic_normalized_idx ON answers(room_code, topic, normalized)",
    ),
  ]);
}

function normalize(value: string, topic?: string | null) {
  return normalizeAnswer(value, topicByName(topic ?? null));
}

function accepted(topic: string, value: string) {
  const config = topicByName(topic);
  if (!config?.answers) return true;
  return config.answers.some(
    (candidate) => normalize(candidate, topic) === normalize(value, topic),
  );
}

function cleanName(value: unknown) {
  return cleanText(value, 12).replace(/\s+/g, " ");
}

function cleanText(value: unknown, maxLength: number) {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .slice(0, maxLength);
}

function cleanPlayerId(value: unknown) {
  const playerId = String(value ?? "")
    .replace(/[^A-Za-z0-9_-]/g, "")
    .slice(0, 64);
  return playerId || crypto.randomUUID();
}

function cleanCode(value: unknown) {
  return String(value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 5);
}

function cleanTimeLimit(value: unknown) {
  const candidate = Number(value);
  return [10, 15, 20].includes(candidate) ? candidate : 15;
}

function cleanMode(value: unknown): Room["mode"] {
  return value === "bomb" ? "bomb" : "normal";
}

function cleanTopicSwitchMode(value: unknown): Room["topic_switch_mode"] {
  return value === "rounds" || value === "miss" ? value : "none";
}

function cleanTopicSwitchRounds(value: unknown) {
  const candidate = Number(value);
  return [1, 2, 3, 5].includes(candidate) ? candidate : 1;
}

function cleanLifeCount(value: unknown) {
  const candidate = Number(value);
  return [2, 3, 5].includes(candidate) ? candidate : 2;
}

function cleanBombDuration(value: unknown) {
  const candidate = Number(value);
  return [60, 180, 300].includes(candidate) ? candidate : 180;
}

function guaranteedBombStartedAt(room: Room, now: number) {
  if (room.mode !== "bomb" || !room.bomb_started_at) {
    return room.bomb_started_at;
  }
  const deadline = room.bomb_started_at + room.bomb_duration * 1000;
  return deadline - now <= 5_000
    ? now + 5_000 - room.bomb_duration * 1000
    : room.bomb_started_at;
}

function cleanSelectedTopic(value: unknown, difficulty: string) {
  const candidate = cleanText(value, 60);
  return topicByName(candidate)?.difficulty === difficulty ? candidate : null;
}

function pickTopicName(
  difficulty: string,
  preferred?: string | null,
  exclude?: string | null,
) {
  const preferredTopic = preferred ? topicByName(preferred) : undefined;
  if (preferredTopic?.difficulty === difficulty) return preferredTopic.name;
  const candidates = topicsForDifficulty(difficulty);
  const alternatives = candidates.filter((topic) => topic.name !== exclude);
  const pool = alternatives.length ? alternatives : candidates;
  const topic = pool[Math.floor(Math.random() * pool.length)];
  if (!topic) throw new Error("お題が見つかりません");
  return topic.name;
}

async function enforceRateLimit(
  playerId: string,
  action: string,
  limit: number,
  windowMs: number,
) {
  const key = `${playerId}:${action}`;
  const now = Date.now();
  const current = await db()
    .prepare("SELECT window_started_at, count FROM request_limits WHERE key = ?")
    .bind(key)
    .first<{ window_started_at: number; count: number }>();
  if (!current || now - current.window_started_at >= windowMs) {
    await db()
      .prepare(
        `INSERT INTO request_limits (key, window_started_at, count) VALUES (?, ?, 1)
         ON CONFLICT(key) DO UPDATE SET window_started_at = excluded.window_started_at, count = 1`,
      )
      .bind(key, now)
      .run();
    return;
  }
  if (current.count >= limit) {
    throw new Error("操作が続いています。少し待ってからもう一度お試しください");
  }
  await db()
    .prepare("UPDATE request_limits SET count = count + 1 WHERE key = ?")
    .bind(key)
    .run();
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

async function transferHostIfNeeded(room: Room, players: Player[]) {
  const host = players.find((player) => player.is_host);
  const now = Date.now();
  const hostIsStale = Boolean(
    room.status === "lobby" &&
    host &&
    now - (host.last_seen_at ?? host.joined_at) > 45_000,
  );
  if (host && !hostIsStale) return players;
  const nextHost = players.find((player) => player.id !== host?.id);
  if (!nextHost) return players;
  await db().batch([
    db()
      .prepare("UPDATE players SET is_host = 0 WHERE room_code = ?")
      .bind(room.code),
    db()
      .prepare("UPDATE players SET is_host = 1 WHERE id = ?")
      .bind(nextHost.id),
  ]);
  return getPlayers(room.code);
}

function nextPlayer(players: Player[], currentId: string) {
  const start = Math.max(0, players.findIndex((player) => player.id === currentId));
  for (let offset = 1; offset <= players.length; offset += 1) {
    const candidate = players[(start + offset) % players.length];
    if (candidate?.is_alive && candidate.id !== currentId) return candidate;
  }
  return players.find((player) => player.is_alive && player.id !== currentId);
}

async function applyNormalMistake(room: Room, playerId: string) {
  const players = await getPlayers(room.code);
  const player = players.find((candidate) => candidate.id === playerId);
  if (!player?.is_alive || room.current_turn !== playerId) {
    throw new Error("いまはあなたの番ではありません");
  }
  const remainingOpponents = players.filter(
    (candidate) => candidate.is_alive && candidate.id !== playerId,
  );
  const now = Date.now();
  const nextRound = room.round + 1;
  const losesLastLife = !room.life_enabled || player.lives <= 1;
  const next = nextPlayer(players, playerId);
  const shouldSwitchTopic = room.topic_switch_mode === "miss";
  const nextTopic = shouldSwitchTopic
    ? pickTopicName(room.difficulty, null, room.topic)
    : room.topic;

  if (losesLastLife && remainingOpponents.length <= 1) {
    const roomUpdate = await db()
      .prepare(
        "UPDATE rooms SET status = 'finished', winner_id = ?, finish_reason = 'last_survivor', current_turn = NULL WHERE code = ? AND current_turn = ? AND turn_started_at = ?",
      )
      .bind(
        remainingOpponents[0]?.id ?? null,
        room.code,
        playerId,
        room.turn_started_at,
      )
      .run();
    if (!roomUpdate.meta.changes) return;
    await db()
      .prepare(
        "UPDATE players SET is_alive = 0, lives = 0, eliminated_at = ? WHERE id = ? AND is_alive = 1",
      )
      .bind(now, playerId)
      .run();
    return { eliminated: true, lives: 0, topicChanged: false };
  }

  if (!next) return;
  const roomUpdate = await db()
    .prepare(
      `UPDATE rooms
       SET current_turn = ?, turn_started_at = ?, round = ?,
           topic = ?, topic_changed_round = ?
       WHERE code = ? AND current_turn = ? AND turn_started_at = ?`,
    )
    .bind(
      next.id,
      now,
      nextRound,
      nextTopic,
      shouldSwitchTopic ? nextRound : room.topic_changed_round,
      room.code,
      playerId,
      room.turn_started_at,
    )
    .run();
  if (!roomUpdate.meta.changes) return;
  await (
    losesLastLife
      ? db()
        .prepare(
          "UPDATE players SET is_alive = 0, lives = 0, eliminated_at = ? WHERE id = ? AND is_alive = 1",
        )
        .bind(now, playerId)
      : db()
        .prepare(
          "UPDATE players SET lives = lives - 1 WHERE id = ? AND is_alive = 1 AND lives = ?",
        )
        .bind(playerId, player.lives)
  ).run();
  return {
    eliminated: losesLastLife,
    lives: losesLastLife ? 0 : player.lives - 1,
    topicChanged: shouldSwitchTopic,
  };
}

async function applyBombExplosion(room: Room) {
  if (!room.current_turn) return;
  const players = await getPlayers(room.code);
  const remaining = players.filter(
    (player) => player.is_alive && player.id !== room.current_turn,
  );
  const now = Date.now();
  if (remaining.length <= 1) {
    const roomUpdate = await db()
      .prepare(
        "UPDATE rooms SET status = 'finished', winner_id = ?, finish_reason = 'last_survivor', current_turn = NULL WHERE code = ? AND current_turn = ? AND bomb_started_at = ?",
      )
      .bind(
        remaining[0]?.id ?? null,
        room.code,
        room.current_turn,
        room.bomb_started_at,
      )
      .run();
    if (!roomUpdate.meta.changes) return;
    await db()
      .prepare(
        "UPDATE players SET is_alive = 0, lives = 0, eliminated_at = ? WHERE id = ? AND is_alive = 1",
      )
      .bind(now, room.current_turn)
      .run();
    return;
  }
  const next = nextPlayer(players, room.current_turn);
  if (!next) return;
  const nextRound = room.round + 1;
  const nextTopic = pickTopicName(room.difficulty, null, room.topic);
  const roomUpdate = await db()
    .prepare(
      `UPDATE rooms
       SET current_turn = ?, turn_started_at = ?, bomb_started_at = ?,
           round = ?, topic = ?, topic_changed_round = ?
       WHERE code = ? AND current_turn = ? AND bomb_started_at = ?`,
    )
    .bind(
      next.id,
      now,
      now,
      nextRound,
      nextTopic,
      nextRound,
      room.code,
      room.current_turn,
      room.bomb_started_at,
    )
    .run();
  if (!roomUpdate.meta.changes) return;
  await db()
    .prepare(
      "UPDATE players SET is_alive = 0, lives = 0, eliminated_at = ? WHERE id = ? AND is_alive = 1",
    )
    .bind(now, room.current_turn)
    .run();
}

async function advanceExpiredRoom(room: Room) {
  if (
    room.status !== "active" ||
    !room.current_turn ||
    !room.turn_started_at
  ) return;
  const now = Date.now();

  if (room.mode === "bomb") {
    if (
      room.bomb_started_at &&
      now - room.bomb_started_at >= room.bomb_duration * 1000
    ) {
      await applyBombExplosion(room);
      return;
    }
    if (
      room.bomb_topic_switch_enabled &&
      now - room.turn_started_at >= 30_000
    ) {
      const nextTopic = pickTopicName(room.difficulty, null, room.topic);
      await db()
        .prepare(
          `UPDATE rooms SET topic = ?, turn_started_at = ?, topic_changed_round = round
           WHERE code = ? AND current_turn = ? AND turn_started_at = ?`,
        )
        .bind(
          nextTopic,
          now,
          room.code,
          room.current_turn,
          room.turn_started_at,
        )
        .run();
    }
    return;
  }

  if (now - room.turn_started_at >= room.time_limit * 1000) {
    await applyNormalMistake(room, room.current_turn);
  }
}

async function state(code: string, playerId?: string) {
  let room = await getRoom(code);
  if (!room) throw new Error("ROOM_NOT_FOUND");
  if (playerId) {
    await db()
      .prepare(
        "UPDATE players SET last_seen_at = ? WHERE id = ? AND room_code = ?",
      )
      .bind(Date.now(), playerId, code)
      .run();
  }
  await advanceExpiredRoom(room);
  room = (await getRoom(code))!;
  let players = await getPlayers(code);
  players = await transferHostIfNeeded(room, players);
  const answerLimit = room.status === "finished" ? 300 : 12;
  const answerResult = await db()
    .prepare(
      `SELECT answers.value, answers.topic, answers.created_at, answers.player_id,
              answers.round, players.name
       FROM answers JOIN players ON players.id = answers.player_id
       WHERE answers.room_code = ?
       ORDER BY answers.created_at ${room.status === "finished" ? "ASC" : "DESC"}
       LIMIT ?`,
    )
    .bind(code, answerLimit)
    .all<{
      value: string;
      topic: string;
      created_at: number;
      player_id: string;
      round: number;
      name: string;
    }>();
  const answerCount = await db()
    .prepare(
      "SELECT COUNT(*) AS count FROM answers WHERE room_code = ? AND topic = ?",
    )
    .bind(code, room.topic ?? "")
    .first<{ count: number }>();
  const topic = topicByName(room.topic);

  return {
    room: {
      code: room.code,
      status: room.status,
      topic: room.topic,
      difficulty: room.difficulty,
      timeLimit: room.time_limit,
      mode: room.mode,
      topicSwitchMode: room.topic_switch_mode,
      topicSwitchRounds: room.topic_switch_rounds,
      selectedTopic: room.selected_topic,
      lifeEnabled: Boolean(room.life_enabled),
      lifeCount: room.life_count,
      bombDuration: room.bomb_duration,
      bombTopicSwitchEnabled: Boolean(room.bomb_topic_switch_enabled),
      availableTopics: topicsForDifficulty(room.difficulty).map(
        (candidate) => candidate.name,
      ),
      currentTurn: room.current_turn,
      deadline:
        room.status === "active" &&
        room.turn_started_at &&
        (room.mode !== "bomb" || room.bomb_topic_switch_enabled)
          ? room.turn_started_at +
            (room.mode === "bomb" ? 30_000 : room.time_limit * 1000)
          : null,
      bombDeadline:
        room.status === "active" &&
        room.mode === "bomb" &&
        room.bomb_started_at
          ? room.bomb_started_at + room.bomb_duration * 1000
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
      lives: player.lives,
      isYou: player.id === playerId,
      eliminatedAt: player.eliminated_at,
      isConnected: Date.now() - (player.last_seen_at ?? player.joined_at) < 15_000,
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

async function getResumableRandomRoom(entry: MatchEntry) {
  if (!entry.room_code) return null;
  let room = await getRoom(entry.room_code);
  if (!room) return null;
  await advanceExpiredRoom(room);
  room = await getRoom(entry.room_code);
  return canResumeRandomRoom(room?.status) ? room : null;
}

async function waitingResponse(playerId: string) {
  const entry = await getMatchEntry(playerId);
  if (!entry || entry.status !== "waiting") {
    throw new Error("マッチング待機が終了しました");
  }
  const waiting = await db()
    .prepare(
      `SELECT COUNT(*) AS count FROM matchmaking_queue
       WHERE status = 'waiting' AND difficulty = ? AND time_limit = ?`,
    )
    .bind(entry.difficulty, entry.time_limit)
    .first<{ count: number }>();
  return {
    matchmaking: {
      status: "waiting",
      difficulty: entry.difficulty,
      timeLimit: entry.time_limit,
      queuedAt: entry.queued_at,
      waitingCount: waiting?.count ?? 1,
    },
    playerId,
  };
}

async function acknowledgeRandomMatch(entry: MatchEntry, playerId: string) {
  if (!entry.room_code) throw new Error("マッチング情報が見つかりません");
  if (entry.status === "matched") {
    await db()
      .prepare(
        "UPDATE matchmaking_queue SET status = 'ready' WHERE player_id = ? AND status = 'matched'",
      )
      .bind(playerId)
      .run();
  }

  const ready = await db()
    .prepare(
      "SELECT COUNT(*) AS count FROM matchmaking_queue WHERE room_code = ? AND status = 'ready'",
    )
    .bind(entry.room_code)
    .first<{ count: number }>();
  if ((ready?.count ?? 0) >= 2) {
    await db()
      .prepare(
        "UPDATE rooms SET status = 'active', turn_started_at = ? WHERE code = ? AND status = 'starting'",
      )
      .bind(Date.now(), entry.room_code)
      .run();
  }

  return { ...(await state(entry.room_code, playerId)), playerId };
}

async function attemptRandomMatch(playerId: string) {
  let activePlayerId = playerId;
  let self = await getMatchEntry(playerId);
  if (!self) throw new Error("マッチング情報が見つかりません");
  if (
    (self.status === "matched" || self.status === "ready") &&
    self.room_code
  ) {
    const resumableRoom = await getResumableRandomRoom(self);
    if (resumableRoom) return acknowledgeRandomMatch(self, playerId);
    activePlayerId = crypto.randomUUID();
    const queuedAt = Date.now();
    await db().batch([
      db()
        .prepare("DELETE FROM matchmaking_queue WHERE player_id = ?")
        .bind(playerId),
      db()
        .prepare(
          `INSERT INTO matchmaking_queue
           (player_id, name, difficulty, time_limit, status, room_code, queued_at)
           VALUES (?, ?, ?, ?, 'waiting', NULL, ?)`,
        )
        .bind(
          activePlayerId,
          self.name,
          self.difficulty,
          self.time_limit,
          queuedAt,
        ),
    ]);
    self = {
      ...self,
      player_id: activePlayerId,
      status: "waiting",
      room_code: null,
      queued_at: queuedAt,
    };
  }
  if (self.status !== "waiting") return waitingResponse(activePlayerId);

  const pairResult = await db()
    .prepare(
      `SELECT * FROM matchmaking_queue
       WHERE status = 'waiting' AND difficulty = ? AND time_limit = ?
       ORDER BY queued_at, player_id LIMIT 2`,
    )
    .bind(self.difficulty, self.time_limit)
    .all<MatchEntry>();
  const pair = pairResult.results;
  if (pair.length < 2 || pair[1].player_id !== activePlayerId) {
    return waitingResponse(activePlayerId);
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
    return waitingResponse(activePlayerId);
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
         (code, status, topic, time_limit, difficulty, current_turn, round, created_at)
         VALUES (?, 'starting', ?, ?, ?, ?, 1, ?)`,
      )
      .bind(
        code,
        topic.name,
        self.time_limit,
        self.difficulty,
        opponent.player_id,
        now,
      ),
    db()
      .prepare(
        "INSERT INTO players (id, room_code, name, is_host, is_alive, score, joined_at, last_seen_at) VALUES (?, ?, ?, 1, 1, 0, ?, ?)",
      )
      .bind(opponent.player_id, code, opponent.name, opponent.queued_at, now),
    db()
      .prepare(
        "INSERT INTO players (id, room_code, name, is_host, is_alive, score, joined_at, last_seen_at) VALUES (?, ?, ?, 0, 1, 0, ?, ?)",
      )
      .bind(self.player_id, code, self.name, self.queued_at, now),
    db()
      .prepare(
        "UPDATE matchmaking_queue SET status = 'matched', room_code = ? WHERE player_id = ?",
      )
      .bind(code, opponent.player_id),
    db()
      .prepare(
        "UPDATE matchmaking_queue SET status = 'ready', room_code = ? WHERE player_id = ?",
      )
      .bind(code, self.player_id),
  ]);

  return { ...(await state(code, activePlayerId)), playerId: activePlayerId };
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
    const playerId = cleanPlayerId(body.playerId);
    const now = Date.now();

    if (action === "matchmake") {
      await enforceRateLimit(playerId, "matchmake", 8, 10_000);
      const name = cleanName(body.name);
      if (!name) throw new Error("名前を入力してください");
      const requestedDifficulty = String(body.difficulty ?? "C").toUpperCase();
      const difficulty = ["S", "A", "B", "C"].includes(requestedDifficulty)
        ? requestedDifficulty
        : "C";
      const timeLimit = randomMatchTimeLimit;

      await db()
        .prepare(
          "DELETE FROM matchmaking_queue WHERE status = 'waiting' AND queued_at < ?",
        )
        .bind(now - 10 * 60 * 1000)
        .run();
      let matchmakingPlayerId = playerId;
      const existing = await getMatchEntry(matchmakingPlayerId);
      if (
        existing?.room_code &&
        (existing.status === "matched" || existing.status === "ready")
      ) {
        const resumableRoom = await getResumableRandomRoom(existing);
        if (resumableRoom) {
          return NextResponse.json(
            await acknowledgeRandomMatch(existing, playerId),
          );
        }
        matchmakingPlayerId = crypto.randomUUID();
        await db()
          .prepare("DELETE FROM matchmaking_queue WHERE player_id = ?")
          .bind(playerId)
          .run();
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
        .bind(matchmakingPlayerId, name, difficulty, timeLimit, now)
        .run();
      return NextResponse.json(await attemptRandomMatch(matchmakingPlayerId));
    }

    if (action === "match_status") {
      return NextResponse.json(await attemptRandomMatch(playerId));
    }

    if (action === "cancel_match") {
      const entry = await getMatchEntry(playerId);
      if (entry?.room_code) {
        const deletion = await db()
          .prepare("DELETE FROM rooms WHERE code = ? AND status = 'starting'")
          .bind(entry.room_code)
          .run();
        if (Number(deletion.meta.changes ?? 0) === 1) {
          await db().batch([
            db()
              .prepare("DELETE FROM players WHERE room_code = ?")
              .bind(entry.room_code),
            db()
              .prepare("DELETE FROM matchmaking_queue WHERE room_code = ?")
              .bind(entry.room_code),
          ]);
        }
      }
      await db()
        .prepare(
          "DELETE FROM matchmaking_queue WHERE player_id = ? AND status IN ('waiting', 'claiming')",
        )
        .bind(playerId)
        .run();
      return NextResponse.json({ matchmaking: { status: "cancelled" } });
    }

    if (action === "create") {
      await enforceRateLimit(playerId, "create", 5, 10_000);
      const name = cleanName(body.name);
      if (!name) throw new Error("名前を入力してください");
      const timeLimit = cleanTimeLimit(body.timeLimit ?? 15);
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
            "INSERT INTO players (id, room_code, name, is_host, is_alive, score, joined_at, last_seen_at) VALUES (?, ?, ?, 1, 1, 0, ?, ?)",
          )
          .bind(playerId, code, name, now, now),
      ]);
      return NextResponse.json({ ...(await state(code, playerId)), playerId });
    }

    const code = cleanCode(body.code);
    const room = await getRoom(code);
    if (!room) throw new Error("ルームが見つかりません");

    if (action === "join") {
      await enforceRateLimit(playerId, "join", 6, 10_000);
      const name = cleanName(body.name);
      if (!name) throw new Error("名前を入力してください");
      if (room.status !== "lobby") throw new Error("このゲームはすでに始まっています");
      const players = await getPlayers(code);
      const returningPlayer = players.find((player) => player.id === playerId);
      if (returningPlayer) {
        return NextResponse.json({ ...(await state(code, playerId)), playerId });
      }
      if (players.length >= 8) throw new Error("このルームは満員です");
      await db()
        .prepare(
          "INSERT INTO players (id, room_code, name, is_host, is_alive, score, joined_at, last_seen_at) VALUES (?, ?, ?, 0, 1, 0, ?, ?)",
        )
        .bind(playerId, code, name, now, now)
        .run();
      return NextResponse.json({ ...(await state(code, playerId)), playerId });
    }

    if (action === "leave") {
      const players = await getPlayers(code);
      const leaving = players.find((player) => player.id === playerId);
      if (!leaving) return NextResponse.json({ left: true });
      if (room.status === "lobby") {
        await db()
          .prepare("DELETE FROM players WHERE id = ? AND room_code = ?")
          .bind(playerId, code)
          .run();
        const remaining = await getPlayers(code);
        if (!remaining.length) {
          await db().prepare("DELETE FROM rooms WHERE code = ?").bind(code).run();
        } else if (leaving.is_host) {
          await db()
            .prepare("UPDATE players SET is_host = 1 WHERE id = ?")
            .bind(remaining[0].id)
            .run();
        }
        return NextResponse.json({ left: true });
      }
      if (room.status === "active" && leaving.is_alive) {
        const remaining = players.filter(
          (player) => player.id !== playerId && player.is_alive,
        );
        const next = nextPlayer(players, playerId);
        await db().batch([
          db()
            .prepare(
              "UPDATE players SET is_alive = 0, lives = 0, eliminated_at = ?, last_seen_at = 0 WHERE id = ?",
            )
            .bind(now, playerId),
          remaining.length <= 1
            ? db()
              .prepare(
                "UPDATE rooms SET status = 'finished', winner_id = ?, finish_reason = 'last_survivor', current_turn = NULL WHERE code = ?",
              )
              .bind(remaining[0]?.id ?? null, code)
            : room.current_turn === playerId && next
              ? db()
                .prepare(
                  `UPDATE rooms
                   SET current_turn = ?, turn_started_at = ?,
                       bomb_started_at = CASE WHEN mode = 'bomb' THEN ? ELSE bomb_started_at END,
                       round = round + 1
                   WHERE code = ?`,
                )
                .bind(next.id, now, now, code)
              : db().prepare("SELECT 1"),
        ]);
      }
      if (leaving.is_host) {
        const nextHost = players.find((player) => player.id !== playerId);
        if (nextHost) {
          await db().batch([
            db().prepare("UPDATE players SET is_host = 0 WHERE id = ?").bind(playerId),
            db().prepare("UPDATE players SET is_host = 1 WHERE id = ?").bind(nextHost.id),
          ]);
        }
      }
      return NextResponse.json({ left: true });
    }

    if (action === "start") {
      const players = await getPlayers(code);
      const requester = players.find((player) => player.id === playerId);
      if (!requester?.is_host) throw new Error("ホストだけが開始できます");
      if (players.length < 2) throw new Error("2人以上そろうと開始できます");
      const topic = pickTopicName(
        room.difficulty,
        room.selected_topic,
      );
      await db().batch([
        db()
          .prepare(
            `UPDATE rooms
             SET status = 'active', topic = ?, current_turn = ?,
                 turn_started_at = ?, bomb_started_at = ?, round = 1,
                 topic_changed_round = 1
             WHERE code = ? AND status = 'lobby'`,
          )
          .bind(
            topic,
            players[0].id,
            now,
            room.mode === "bomb" ? now : null,
            code,
          ),
        db()
          .prepare(
            "UPDATE players SET is_alive = 1, score = 0, eliminated_at = NULL, lives = ? WHERE room_code = ?",
          )
          .bind(
            room.mode === "normal" && room.life_enabled ? room.life_count : 1,
            code,
          ),
      ]);
      return NextResponse.json(await state(code, playerId));
    }

    if (action === "update_settings") {
      await enforceRateLimit(playerId, "update_settings", 12, 10_000);
      const players = await getPlayers(code);
      const requester = players.find((player) => player.id === playerId);
      if (!requester?.is_host) throw new Error("ホストだけが設定を変更できます");
      if (room.status !== "lobby") throw new Error("開始後は設定を変更できません");
      const requestedDifficulty = String(body.difficulty ?? room.difficulty).toUpperCase();
      const difficulty = ["S", "A", "B", "C"].includes(requestedDifficulty)
        ? requestedDifficulty
        : room.difficulty;
      const timeLimit = cleanTimeLimit(body.timeLimit ?? room.time_limit);
      const mode = cleanMode(body.mode ?? room.mode);
      const topicSwitchMode = cleanTopicSwitchMode(
        body.topicSwitchMode ?? room.topic_switch_mode,
      );
      const topicSwitchRounds = cleanTopicSwitchRounds(
        body.topicSwitchRounds ?? room.topic_switch_rounds,
      );
      const lifeEnabled = body.lifeEnabled === undefined
        ? Boolean(room.life_enabled)
        : body.lifeEnabled === true || body.lifeEnabled === 1;
      const lifeCount = cleanLifeCount(body.lifeCount ?? room.life_count);
      const bombDuration = cleanBombDuration(
        body.bombDuration ?? room.bomb_duration,
      );
      const bombTopicSwitchEnabled = body.bombTopicSwitchEnabled === undefined
        ? Boolean(room.bomb_topic_switch_enabled)
        : body.bombTopicSwitchEnabled === true ||
          body.bombTopicSwitchEnabled === 1;
      const selectedTopic = cleanSelectedTopic(
        body.selectedTopic === undefined
          ? room.selected_topic
          : body.selectedTopic,
        difficulty,
      );
      await db().batch([
        db()
          .prepare(
            `UPDATE rooms
             SET difficulty = ?, time_limit = ?, mode = ?,
                 topic_switch_mode = ?, topic_switch_rounds = ?,
                 selected_topic = ?, life_enabled = ?, life_count = ?,
                 bomb_duration = ?, bomb_topic_switch_enabled = ?
             WHERE code = ? AND status = 'lobby'`,
          )
          .bind(
            difficulty,
            timeLimit,
            mode,
            topicSwitchMode,
            topicSwitchRounds,
            selectedTopic,
            lifeEnabled ? 1 : 0,
            lifeCount,
            bombDuration,
            bombTopicSwitchEnabled ? 1 : 0,
            code,
          ),
        db()
          .prepare("UPDATE players SET lives = ? WHERE room_code = ?")
          .bind(mode === "normal" && lifeEnabled ? lifeCount : 1, code),
      ]);
      return NextResponse.json(await state(code, playerId));
    }

    if (action === "rematch") {
      const players = await getPlayers(code);
      const requester = players.find((player) => player.id === playerId);
      if (!requester?.is_host) throw new Error("ホストだけが再戦を開始できます");
      if (room.status !== "finished") throw new Error("ゲームはまだ終了していません");
      await db().batch([
        db().prepare("DELETE FROM answers WHERE room_code = ?").bind(code),
        db()
          .prepare(
            "DELETE FROM players WHERE room_code = ? AND COALESCE(last_seen_at, joined_at) < ?",
          )
          .bind(code, now - 15_000),
        db()
          .prepare(
            "UPDATE players SET is_alive = 1, score = 0, eliminated_at = NULL, lives = ? WHERE room_code = ?",
          )
          .bind(
            room.mode === "normal" && room.life_enabled ? room.life_count : 1,
            code,
          ),
        db()
          .prepare(
            `UPDATE rooms SET status = 'lobby', topic = NULL, current_turn = NULL,
             turn_started_at = NULL, bomb_started_at = NULL,
             winner_id = NULL, finish_reason = NULL, round = 0,
             topic_changed_round = 1
             WHERE code = ?`,
          )
          .bind(code),
      ]);
      return NextResponse.json(await state(code, playerId));
    }

    if (action === "answer") {
      await enforceRateLimit(playerId, "answer", 6, 5_000);
      await advanceExpiredRoom(room);
      const freshRoom = await getRoom(code);
      if (!freshRoom || freshRoom.status !== "active") throw new Error("ゲームは終了しました");
      if (freshRoom.current_turn !== playerId) throw new Error("いまはあなたの番ではありません");
      const value = cleanText(body.answer, 30);
      if (!value) throw new Error("答えを入力してください");
      const rejectAnswer = async (message: string) => {
        if (freshRoom.mode === "bomb") throw new Error(message);
        const result = await applyNormalMistake(freshRoom, playerId);
        if (!result) {
          return NextResponse.json({
            ...(await state(code, playerId)),
            notice: "すでに次のターンへ進んでいます。",
          });
        }
        const notice = result?.eliminated
          ? `${message} 脱落しました。`
          : `${message} 残りライフは${result.lives}です。`;
        return NextResponse.json({
          ...(await state(code, playerId)),
          notice: result.topicChanged ? `${notice} お題が変わりました。` : notice,
        });
      };
      if (!freshRoom.topic || !accepted(freshRoom.topic, value)) {
        return rejectAnswer("その答えはお題に合っていません。");
      }
      const normalized = normalize(value, freshRoom.topic);
      const previousAnswers = await db()
        .prepare("SELECT value FROM answers WHERE room_code = ? AND topic = ?")
        .bind(code, freshRoom.topic)
        .all<{ value: string }>();
      if (
        previousAnswers.results.some(
          (answer) => normalize(answer.value, freshRoom.topic) === normalized,
        )
      ) {
        return rejectAnswer("その答えはもう出ています。");
      }
      const players = await getPlayers(code);
      const next = nextPlayer(players, playerId);
      if (!next) throw new Error("次のプレイヤーが見つかりません");
      const topic = topicByName(freshRoom.topic);
      const count = await db()
        .prepare(
          "SELECT COUNT(*) AS count FROM answers WHERE room_code = ? AND topic = ?",
        )
        .bind(code, freshRoom.topic)
        .first<{ count: number }>();
      const completesTopic = Boolean(
        topic?.completable &&
        topic.answers &&
        (count?.count ?? 0) + 1 >= topic.answers.length,
      );
      const nextRound = freshRoom.round + 1;
      const aliveCount = players.filter((player) => player.is_alive).length;
      const shouldSwitchTopic = freshRoom.mode === "normal" &&
        freshRoom.topic_switch_mode === "rounds" &&
        nextRound - freshRoom.topic_changed_round >=
          freshRoom.topic_switch_rounds * aliveCount;
      const nextTopic = shouldSwitchTopic
        ? pickTopicName(freshRoom.difficulty, null, freshRoom.topic)
        : freshRoom.topic;
      const nextBombStartedAt = guaranteedBombStartedAt(freshRoom, now);
      const operations = [
        db()
          .prepare(
            "INSERT INTO answers (id, room_code, player_id, topic, value, normalized, round, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
          )
          .bind(
            crypto.randomUUID(),
            code,
            playerId,
            freshRoom.topic,
            value,
            normalized,
            freshRoom.round,
            now,
          ),
        db().prepare("UPDATE players SET score = score + 1 WHERE id = ?").bind(playerId),
        completesTopic
          ? db()
            .prepare(
              "UPDATE rooms SET status = 'finished', finish_reason = 'completed', winner_id = NULL, current_turn = NULL WHERE code = ? AND current_turn = ?",
            )
            .bind(code, playerId)
          : db()
          .prepare(
            `UPDATE rooms
             SET current_turn = ?, turn_started_at = ?, round = ?,
                 topic = ?, topic_changed_round = ?, bomb_started_at = ?
             WHERE code = ? AND current_turn = ?`,
          )
          .bind(
            next.id,
            now,
            nextRound,
            nextTopic,
            shouldSwitchTopic ? nextRound : freshRoom.topic_changed_round,
            nextBombStartedAt,
            code,
            playerId,
          ),
      ];
      await db().batch(operations);
      return NextResponse.json(await state(code, playerId));
    }

    throw new Error("操作を確認してください");
  } catch (error) {
    const raw = error instanceof Error ? error.message : "操作に失敗しました";
    const message = raw.includes("answers_room_round_idx") ||
      raw.includes("answers.room_code, answers.round")
      ? "このターンの回答はすでに送信されています"
      : raw.includes("answers_room_topic_normalized_idx") ||
          raw.includes("answers.room_code, answers.topic, answers.normalized")
        ? "その答えはもう出ています"
        : raw.includes("players_room_name_idx") ||
            raw.includes("players.room_code, players.name")
          ? "その名前はすでに使われています"
          : raw.includes("UNIQUE")
            ? "同じ内容がすでに登録されています"
      : raw;
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
