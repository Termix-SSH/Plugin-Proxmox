-- proxmox 0002: mysql_indexes
-- 0001 skipped the indexes on MySQL, so a table it created fresh has none.
-- MySQL has no CREATE INDEX IF NOT EXISTS, so the table is rebuilt with its
-- index and the rows copied over, dropping duplicates on the way.

DROP TABLE IF EXISTS `p_proxmox_stats_preferences_rebuild`;
DROP TABLE IF EXISTS `p_proxmox_stats_preferences_old`;
CREATE TABLE `p_proxmox_stats_preferences_rebuild` (
  `id` int AUTO_INCREMENT PRIMARY KEY,
  `user_id` varchar(255) NOT NULL,
  `host_id` int NOT NULL,
  `layout` text NOT NULL,
  `created_at` text NOT NULL DEFAULT (CURRENT_TIMESTAMP),
  `updated_at` text NOT NULL DEFAULT (CURRENT_TIMESTAMP),
  FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  FOREIGN KEY (`host_id`) REFERENCES `ssh_data` (`id`) ON DELETE CASCADE
);
CREATE UNIQUE INDEX `idx_proxmox_stats_prefs_user_host` ON `p_proxmox_stats_preferences_rebuild` (`user_id`, `host_id`);
-- Keep the newest layout of each user and host pair.
INSERT INTO `p_proxmox_stats_preferences_rebuild` (`id`, `user_id`, `host_id`, `layout`, `created_at`, `updated_at`)
SELECT p.`id`, p.`user_id`, p.`host_id`, p.`layout`, p.`created_at`, p.`updated_at`
FROM `p_proxmox_stats_preferences` p
JOIN (
  SELECT MAX(`id`) AS `id` FROM `p_proxmox_stats_preferences` GROUP BY `user_id`, `host_id`
) keep ON keep.`id` = p.`id`;
RENAME TABLE `p_proxmox_stats_preferences` TO `p_proxmox_stats_preferences_old`, `p_proxmox_stats_preferences_rebuild` TO `p_proxmox_stats_preferences`;
DROP TABLE `p_proxmox_stats_preferences_old`;
