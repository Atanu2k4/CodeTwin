CREATE TABLE `memory_node` (
	`id` text PRIMARY KEY,
	`project_id` text NOT NULL,
	`session_id` text NOT NULL,
	`message_id` text,
	`part_id` text,
	`entity_type` text NOT NULL,
	`label` text NOT NULL,
	`content` text NOT NULL,
	`reasoning` text,
	`time_invalidated` integer,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	CONSTRAINT `fk_memory_node_project_id_project_id_fk` FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_memory_node_session_id_session_id_fk` FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_memory_node_message_id_message_id_fk` FOREIGN KEY (`message_id`) REFERENCES `message`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_memory_node_part_id_part_id_fk` FOREIGN KEY (`part_id`) REFERENCES `part`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE TABLE `memory_edge` (
	`id` text PRIMARY KEY,
	`project_id` text NOT NULL,
	`session_id` text NOT NULL,
	`source_node_id` text NOT NULL,
	`target_node_id` text NOT NULL,
	`edge_type` text NOT NULL,
	`strength` integer,
	`reason` text,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	CONSTRAINT `fk_memory_edge_project_id_project_id_fk` FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_memory_edge_session_id_session_id_fk` FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_memory_edge_source_node_id_memory_node_id_fk` FOREIGN KEY (`source_node_id`) REFERENCES `memory_node`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_memory_edge_target_node_id_memory_node_id_fk` FOREIGN KEY (`target_node_id`) REFERENCES `memory_node`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `causal_edge` (
	`id` text PRIMARY KEY,
	`project_id` text NOT NULL,
	`session_id` text NOT NULL,
	`source_message_id` text,
	`source_part_id` text,
	`target_node_id` text NOT NULL,
	`causal_type` text NOT NULL,
	`impact` text,
	`reversal_possible` integer NOT NULL DEFAULT 0,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	CONSTRAINT `fk_causal_edge_project_id_project_id_fk` FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_causal_edge_session_id_session_id_fk` FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_causal_edge_source_message_id_message_id_fk` FOREIGN KEY (`source_message_id`) REFERENCES `message`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_causal_edge_source_part_id_part_id_fk` FOREIGN KEY (`source_part_id`) REFERENCES `part`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_causal_edge_target_node_id_memory_node_id_fk` FOREIGN KEY (`target_node_id`) REFERENCES `memory_node`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `session_memory_meta` (
	`session_id` text PRIMARY KEY,
	`memory_node_count` integer NOT NULL DEFAULT 0,
	`decision_count` integer NOT NULL DEFAULT 0,
	`failure_count` integer NOT NULL DEFAULT 0,
	`default_dependence_level` integer NOT NULL DEFAULT 3,
	`requires_approval_after_failure_count` integer NOT NULL DEFAULT 2,
	`last_memory_update` integer,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	CONSTRAINT `fk_session_memory_meta_session_id_session_id_fk` FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `project_memory_meta` (
	`project_id` text PRIMARY KEY,
	`default_dependence_level` integer NOT NULL DEFAULT 3,
	`failure_threshold` integer NOT NULL DEFAULT 3,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	CONSTRAINT `fk_project_memory_meta_project_id_project_id_fk` FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `memory_node_project_idx` ON `memory_node` (`project_id`);--> statement-breakpoint
CREATE INDEX `memory_node_session_idx` ON `memory_node` (`session_id`);--> statement-breakpoint
CREATE INDEX `memory_node_entity_type_idx` ON `memory_node` (`entity_type`);--> statement-breakpoint
CREATE INDEX `memory_node_message_idx` ON `memory_node` (`message_id`);--> statement-breakpoint
CREATE INDEX `memory_edge_project_idx` ON `memory_edge` (`project_id`);--> statement-breakpoint
CREATE INDEX `memory_edge_session_idx` ON `memory_edge` (`session_id`);--> statement-breakpoint
CREATE INDEX `memory_edge_source_node_idx` ON `memory_edge` (`source_node_id`);--> statement-breakpoint
CREATE INDEX `memory_edge_target_node_idx` ON `memory_edge` (`target_node_id`);--> statement-breakpoint
CREATE INDEX `memory_edge_edge_type_idx` ON `memory_edge` (`edge_type`);--> statement-breakpoint
CREATE INDEX `causal_edge_project_idx` ON `causal_edge` (`project_id`);--> statement-breakpoint
CREATE INDEX `causal_edge_session_idx` ON `causal_edge` (`session_id`);--> statement-breakpoint
CREATE INDEX `causal_edge_message_idx` ON `causal_edge` (`source_message_id`);--> statement-breakpoint
CREATE INDEX `causal_edge_target_node_idx` ON `causal_edge` (`target_node_id`);--> statement-breakpoint
CREATE INDEX `causal_edge_causal_type_idx` ON `causal_edge` (`causal_type`);