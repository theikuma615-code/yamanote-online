DROP INDEX IF EXISTS `answers_room_normalized_idx`;--> statement-breakpoint
ALTER TABLE `answers` ADD `topic` text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `answers_room_topic_normalized_idx` ON `answers` (`room_code`,`topic`,`normalized`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_rooms` (
	`code` text PRIMARY KEY NOT NULL,
	`status` text DEFAULT 'lobby' NOT NULL,
	`topic` text,
	`time_limit` integer DEFAULT 15 NOT NULL,
	`difficulty` text DEFAULT 'C' NOT NULL,
	`mode` text DEFAULT 'normal' NOT NULL,
	`topic_switch_mode` text DEFAULT 'none' NOT NULL,
	`topic_switch_rounds` integer DEFAULT 1 NOT NULL,
	`topic_changed_round` integer DEFAULT 1 NOT NULL,
	`selected_topic` text,
	`life_enabled` integer DEFAULT false NOT NULL,
	`life_count` integer DEFAULT 1 NOT NULL,
	`bomb_duration` integer DEFAULT 180 NOT NULL,
	`bomb_started_at` integer,
	`current_turn` text,
	`turn_started_at` integer,
	`winner_id` text,
	`finish_reason` text,
	`round` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_rooms`(
	"code", "status", "topic", "time_limit", "difficulty", "mode",
	"topic_switch_mode", "topic_switch_rounds", "topic_changed_round",
	"selected_topic", "life_enabled", "life_count", "bomb_duration",
	"bomb_started_at", "current_turn", "turn_started_at", "winner_id",
	"finish_reason", "round", "created_at"
)
SELECT
	"code", "status", "topic", "time_limit", "difficulty", 'normal',
	'none', 1, 1, NULL, 0, 1, 180,
	NULL, "current_turn", "turn_started_at", "winner_id",
	"finish_reason", "round", "created_at"
FROM `rooms`;--> statement-breakpoint
DROP TABLE `rooms`;--> statement-breakpoint
ALTER TABLE `__new_rooms` RENAME TO `rooms`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
ALTER TABLE `players` ADD `lives` integer DEFAULT 1 NOT NULL;
