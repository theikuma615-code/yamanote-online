CREATE TABLE `matchmaking_queue` (
	`player_id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`difficulty` text NOT NULL,
	`time_limit` integer NOT NULL,
	`status` text DEFAULT 'waiting' NOT NULL,
	`room_code` text,
	`queued_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `matchmaking_search_idx` ON `matchmaking_queue` (`status`,`difficulty`,`time_limit`,`queued_at`);