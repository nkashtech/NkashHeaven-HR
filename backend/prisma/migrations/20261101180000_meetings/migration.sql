ALTER TABLE `Message` ADD COLUMN `receiverOnly` BOOLEAN NOT NULL DEFAULT false;

-- Call and meeting notices already sent are hidden from the person who started them.
UPDATE `Message` SET `receiverOnly` = true
WHERE `senderId` IS NOT NULL AND (`body` REGEXP ' started a (video |voice )?call$' OR `body` = 'Missed call' OR `body` LIKE '% shared a meeting');

ALTER TABLE `CalendarConnection` ADD COLUMN `canWrite` BOOLEAN NOT NULL DEFAULT false;
UPDATE `CalendarConnection` SET `canWrite` = `pushLeave`;

ALTER TABLE `CompanyEvent`
  ADD COLUMN `meetingType` VARCHAR(191) NOT NULL DEFAULT 'NONE',
  ADD COLUMN `conversationId` INT NULL;

CREATE TABLE `MeetingInvite` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `companyId` INT NOT NULL,
  `eventId` INT NOT NULL,
  `userId` INT NOT NULL,
  `status` VARCHAR(191) NOT NULL DEFAULT 'PENDING',
  `tokenHash` VARCHAR(191) NOT NULL,
  `respondedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `MeetingInvite_tokenHash_key`(`tokenHash`),
  UNIQUE INDEX `MeetingInvite_eventId_userId_key`(`eventId`, `userId`),
  INDEX `MeetingInvite_userId_idx`(`userId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
