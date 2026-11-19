UPDATE bookings_locations SET slots = '[]' WHERE inventoryMode = 1;
--> statement-breakpoint
UPDATE bookings_locations SET slots = (SELECT json_group_array(CASE s.type WHEN 'object' THEN json_remove(s.value, '$.capacity') WHEN 'array' THEN json(s.value) ELSE s.value END) FROM (SELECT key, type, value FROM json_each(bookings_locations.slots) ORDER BY key) s)
  WHERE CASE WHEN json_valid(slots) THEN json_type(slots) = 'array' AND json_array_length(slots) > 0 ELSE 0 END;
--> statement-breakpoint
ALTER TABLE `bookings_locations` DROP COLUMN `inventoryMode`;--> statement-breakpoint
ALTER TABLE `bookings_locations` DROP COLUMN `quantity`;