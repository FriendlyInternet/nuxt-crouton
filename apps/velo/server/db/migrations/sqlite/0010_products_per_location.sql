INSERT OR IGNORE INTO catalog_products (id, teamId, owner, "order", title, active, translations, createdAt, updatedAt, createdBy, updatedBy)
SELECT 'loc-' || l.id, l.teamId, l.owner, 0, l.title, 1,
  (SELECT json_group_object(k, json(v)) FROM (
     SELECT t.key AS k, json_object('title', json_extract(t.value, '$.title')) AS v
       FROM json_each(CASE WHEN json_valid(l.translations) AND json_type(l.translations) = 'object' THEN l.translations ELSE '{}' END) t
      WHERE COALESCE(json_extract(t.value, '$.title'), '') <> ''
     UNION ALL
     SELECT 'en', json_object('title', l.title)
      WHERE NOT EXISTS (
        SELECT 1 FROM json_each(CASE WHEN json_valid(l.translations) AND json_type(l.translations) = 'object' THEN l.translations ELSE '{}' END) t2
         WHERE t2.key = 'en' AND COALESCE(json_extract(t2.value, '$.title'), '') <> '')
  )),
  l.createdAt, l.updatedAt, l.createdBy, l.updatedBy
FROM bookings_locations l WHERE l.products IS NULL;
--> statement-breakpoint
UPDATE bookings_locations SET products = json_array(json_object('product', 'loc-' || id, 'stock',
  MAX(1, COALESCE(CASE WHEN inventoryMode = 1 THEN quantity
    ELSE (SELECT MAX(CAST(json_extract(s.value, '$.capacity') AS INTEGER))
            FROM json_each(CASE WHEN json_valid(slots) AND json_type(slots) = 'array' THEN slots ELSE '[]' END) s) END, 1))))
WHERE products IS NULL;
--> statement-breakpoint
UPDATE bookings_bookings SET product = 'loc-' || location WHERE product IS NULL;
