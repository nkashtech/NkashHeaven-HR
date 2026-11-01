ALTER TABLE `Profile` ADD COLUMN `displayName` VARCHAR(191) NULL;

ALTER TABLE `Message`
  ADD COLUMN `replyToId` INT NULL,
  ADD COLUMN `forwardedFrom` VARCHAR(191) NULL,
  ADD COLUMN `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3);

CREATE INDEX `Message_conversationId_updatedAt_idx` ON `Message`(`conversationId`, `updatedAt`);

CREATE TABLE `Call` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `companyId` INT NOT NULL,
  `conversationId` INT NOT NULL,
  `startedById` INT NOT NULL,
  `video` BOOLEAN NOT NULL DEFAULT true,
  `startedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `endedAt` DATETIME(3) NULL,
  INDEX `Call_conversationId_endedAt_idx`(`conversationId`, `endedAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `CallMember` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `companyId` INT NOT NULL,
  `callId` INT NOT NULL,
  `userId` INT NOT NULL,
  `joinedAt` DATETIME(3) NULL,
  `leftAt` DATETIME(3) NULL,
  `declinedAt` DATETIME(3) NULL,
  `lastSeenAt` DATETIME(3) NULL,
  UNIQUE INDEX `CallMember_callId_userId_key`(`callId`, `userId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `CallSignal` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `companyId` INT NOT NULL,
  `callId` INT NOT NULL,
  `fromId` INT NOT NULL,
  `toId` INT NOT NULL,
  `kind` VARCHAR(191) NOT NULL,
  `payload` MEDIUMTEXT NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `CallSignal_callId_toId_id_idx`(`callId`, `toId`, `id`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
