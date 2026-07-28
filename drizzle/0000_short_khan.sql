CREATE TABLE `answers` (
	`id` text PRIMARY KEY NOT NULL,
	`room_code` text NOT NULL,
	`player_id` text NOT NULL,
	`value` text NOT NULL,
	`normalized` text NOT NULL,
	`round` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `answers_room_normalized_idx` ON `answers` (`room_code`,`normalized`);--> statement-breakpoint
CREATE TABLE `players` (
	`id` text PRIMARY KEY NOT NULL,
	`room_code` text NOT NULL,
	`name` text NOT NULL,
	`is_host` integer DEFAULT false NOT NULL,
	`is_alive` integer DEFAULT true NOT NULL,
	`score` integer DEFAULT 0 NOT NULL,
	`joined_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `players_room_name_idx` ON `players` (`room_code`,`name`);--> statement-breakpoint
CREATE TABLE `rooms` (
	`code` text PRIMARY KEY NOT NULL,
	`status` text DEFAULT 'lobby' NOT NULL,
	`topic` text,
	`time_limit` integer DEFAULT 10 NOT NULL,
	`current_turn` text,
	`turn_started_at` integer,
	`winner_id` text,
	`round` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL
);
