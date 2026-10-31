-- firstName and lastName exist but were never filled. Everyone's name splits at the first space.
ALTER TABLE `Profile` ADD COLUMN `middleName` VARCHAR(191) NULL;

UPDATE `Profile` p JOIN `User` u ON u.id = p.userId
SET p.firstName = COALESCE(p.firstName, SUBSTRING_INDEX(TRIM(u.name), ' ', 1)),
    p.lastName = COALESCE(p.lastName, NULLIF(TRIM(SUBSTRING(TRIM(u.name), CHAR_LENGTH(SUBSTRING_INDEX(TRIM(u.name), ' ', 1)) + 1)), ''));
