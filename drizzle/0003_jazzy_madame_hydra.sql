CREATE TABLE `request_limits` (
	`key` text PRIMARY KEY NOT NULL,
	`window_started_at` integer NOT NULL,
	`count` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
ALTER TABLE `players` ADD `eliminated_at` integer;--> statement-breakpoint
ALTER TABLE `players` ADD `last_seen_at` integer;--> statement-breakpoint
CREATE UNIQUE INDEX `answers_room_round_idx` ON `answers` (`room_code`,`round`);