-- Email verification is now required where crouton-email is installed:
-- mark every existing account verified so nobody is locked out.
UPDATE `user` SET `emailVerified` = 1 WHERE `emailVerified` = 0;
