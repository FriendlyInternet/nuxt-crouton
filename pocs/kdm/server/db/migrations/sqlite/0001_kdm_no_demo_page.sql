-- kdm keeps the package demo pages (crouton-pages' `welcome`, and any other package's) out of its team (#4559).
-- The staging seed still runs, so the `kdm` team and the review login keep their fixed ids; only seed-owned pages are dropped.
DELETE FROM `pages_pages` WHERE `owner` = 'seed';--> statement-breakpoint
CREATE TRIGGER `kdm_skip_seed_page_insert` BEFORE INSERT ON `pages_pages` WHEN NEW.`owner` = 'seed' BEGIN SELECT RAISE(IGNORE); END;--> statement-breakpoint
CREATE TRIGGER `kdm_skip_seed_page_update` BEFORE UPDATE ON `pages_pages` WHEN NEW.`owner` = 'seed' BEGIN SELECT RAISE(IGNORE); END;
