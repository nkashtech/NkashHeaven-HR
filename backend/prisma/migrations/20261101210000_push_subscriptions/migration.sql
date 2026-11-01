CREATE TABLE `PushSubscription` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `companyId` INT NOT NULL,
  `userId` INT NOT NULL,
  `endpoint` VARCHAR(500) NOT NULL,
  `p256dh` VARCHAR(191) NOT NULL,
  `auth` VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `PushSubscription_endpoint_key`(`endpoint`),
  INDEX `PushSubscription_userId_idx`(`userId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
