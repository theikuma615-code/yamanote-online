import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const rooms = sqliteTable("rooms", {
  code: text("code").primaryKey(),
  status: text("status").notNull().default("lobby"),
  topic: text("topic"),
  timeLimit: integer("time_limit").notNull().default(10),
  difficulty: text("difficulty").notNull().default("C"),
  currentTurn: text("current_turn"),
  turnStartedAt: integer("turn_started_at"),
  winnerId: text("winner_id"),
  finishReason: text("finish_reason"),
  round: integer("round").notNull().default(0),
  createdAt: integer("created_at").notNull(),
});

export const players = sqliteTable(
  "players",
  {
    id: text("id").primaryKey(),
    roomCode: text("room_code").notNull(),
    name: text("name").notNull(),
    isHost: integer("is_host", { mode: "boolean" }).notNull().default(false),
    isAlive: integer("is_alive", { mode: "boolean" }).notNull().default(true),
    score: integer("score").notNull().default(0),
    joinedAt: integer("joined_at").notNull(),
  },
  (table) => [uniqueIndex("players_room_name_idx").on(table.roomCode, table.name)],
);

export const answers = sqliteTable(
  "answers",
  {
    id: text("id").primaryKey(),
    roomCode: text("room_code").notNull(),
    playerId: text("player_id").notNull(),
    value: text("value").notNull(),
    normalized: text("normalized").notNull(),
    round: integer("round").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("answers_room_normalized_idx").on(
      table.roomCode,
      table.normalized,
    ),
  ],
);

export const matchmakingQueue = sqliteTable(
  "matchmaking_queue",
  {
    playerId: text("player_id").primaryKey(),
    name: text("name").notNull(),
    difficulty: text("difficulty").notNull(),
    timeLimit: integer("time_limit").notNull(),
    status: text("status").notNull().default("waiting"),
    roomCode: text("room_code"),
    queuedAt: integer("queued_at").notNull(),
  },
  (table) => [
    index("matchmaking_search_idx").on(
      table.status,
      table.difficulty,
      table.timeLimit,
      table.queuedAt,
    ),
  ],
);
