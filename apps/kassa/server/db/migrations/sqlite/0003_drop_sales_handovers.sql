-- Drop the orphaned handovers table (#1855).
--
-- It backed the two-stage pass model from epic #1755, which #1851 replaced:
-- sending out is location-dependent, so the kitchen-display tap IS the send-out
-- and there is no separate handover step. The package-side code, endpoints and
-- block were removed with #1853; this drops the table they wrote to.
--
-- Safe to drop: nothing reads it any more, and the outstanding count now derives
-- from `sales_kdsbumps`. Only ever written by the pass screen, which is gone.
DROP TABLE IF EXISTS `sales_handovers`;
