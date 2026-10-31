-- CreateTable
CREATE TABLE `Company` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `timezone` VARCHAR(191) NOT NULL DEFAULT 'Africa/Johannesburg',
    `seats` INTEGER NOT NULL DEFAULT 100,
    `settings` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Department` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `companyId` INTEGER NOT NULL DEFAULT 1,
    `name` VARCHAR(191) NOT NULL,
    `managerId` INTEGER NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `Department_companyId_name_key`(`companyId`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `WorkSchedule` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `companyId` INTEGER NOT NULL DEFAULT 1,
    `name` VARCHAR(191) NOT NULL,
    `days` JSON NOT NULL,
    `breakMinutes` INTEGER NOT NULL DEFAULT 60,
    `hoursPerDay` DOUBLE NOT NULL DEFAULT 8,
    `active` BOOLEAN NOT NULL DEFAULT true,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PublicHoliday` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `companyId` INTEGER NOT NULL DEFAULT 1,
    `date` DATE NOT NULL,
    `name` VARCHAR(191) NOT NULL,

    UNIQUE INDEX `PublicHoliday_companyId_date_key`(`companyId`, `date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `User` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `companyId` INTEGER NOT NULL DEFAULT 1,
    `employeeNo` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `passwordHash` VARCHAR(191) NULL,
    `role` ENUM('EMPLOYEE', 'SUPERVISOR', 'MANAGER', 'ADMIN', 'SUPER_ADMIN') NOT NULL DEFAULT 'EMPLOYEE',
    `jobTitle` VARCHAR(191) NULL,
    `departmentId` INTEGER NULL,
    `managerId` INTEGER NULL,
    `supervisorId` INTEGER NULL,
    `scheduleId` INTEGER NULL,
    `timezone` VARCHAR(191) NOT NULL DEFAULT 'Africa/Johannesburg',
    `active` BOOLEAN NOT NULL DEFAULT true,
    `archivedAt` DATETIME(3) NULL,
    `startDate` DATE NOT NULL,
    `salaryBand` VARCHAR(191) NULL,
    `mustChangePassword` BOOLEAN NOT NULL DEFAULT false,
    `tempPasswordExpiry` DATETIME(3) NULL,
    `inviteStatus` ENUM('NONE', 'SENT', 'OPENED', 'ACTIVATED', 'EXPIRED', 'BOUNCED') NOT NULL DEFAULT 'NONE',
    `invitedAt` DATETIME(3) NULL,
    `setupCompleted` BOOLEAN NOT NULL DEFAULT false,
    `activatedAt` DATETIME(3) NULL,
    `failedLogins` INTEGER NOT NULL DEFAULT 0,
    `lockedUntil` DATETIME(3) NULL,
    `twoFactorOn` BOOLEAN NOT NULL DEFAULT false,
    `twoFactorEnc` TEXT NULL,
    `resetTokenHash` VARCHAR(191) NULL,
    `resetTokenExp` DATETIME(3) NULL,
    `lastLoginAt` DATETIME(3) NULL,
    `theme` VARCHAR(191) NOT NULL DEFAULT 'system',
    `language` VARCHAR(191) NOT NULL DEFAULT 'en',
    `dateFormat` VARCHAR(191) NOT NULL DEFAULT 'dd MMM yyyy',
    `showBirthday` BOOLEAN NOT NULL DEFAULT true,
    `showPhone` BOOLEAN NOT NULL DEFAULT true,
    `doNotDisturb` BOOLEAN NOT NULL DEFAULT false,
    `notifyPrefs` JSON NULL,
    `chatDigest` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `User_employeeNo_key`(`employeeNo`),
    UNIQUE INDEX `User_email_key`(`email`),
    INDEX `User_departmentId_idx`(`departmentId`),
    INDEX `User_managerId_idx`(`managerId`),
    INDEX `User_supervisorId_idx`(`supervisorId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Profile` (
    `userId` INTEGER NOT NULL,
    `companyId` INTEGER NOT NULL DEFAULT 1,
    `legalName` VARCHAR(191) NULL,
    `preferredName` VARCHAR(191) NULL,
    `birthDate` DATE NULL,
    `idNumberEnc` TEXT NULL,
    `taxNumberEnc` TEXT NULL,
    `phone` VARCHAR(191) NULL,
    `personalEmail` VARCHAR(191) NULL,
    `address` VARCHAR(500) NULL,
    `emergencyName` VARCHAR(191) NULL,
    `emergencyRelation` VARCHAR(191) NULL,
    `emergencyPhone` VARCHAR(191) NULL,
    `bankName` VARCHAR(191) NULL,
    `bankAccountEnc` TEXT NULL,
    `bankAccountType` VARCHAR(191) NULL,
    `photoFileId` INTEGER NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`userId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ProfileChange` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `companyId` INTEGER NOT NULL DEFAULT 1,
    `userId` INTEGER NOT NULL,
    `actorId` INTEGER NOT NULL,
    `field` VARCHAR(191) NOT NULL,
    `oldValue` TEXT NULL,
    `newValue` TEXT NULL,
    `seenById` INTEGER NULL,
    `seenAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ProfileChange_userId_idx`(`userId`),
    INDEX `ProfileChange_seenAt_idx`(`seenAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ChangeRequest` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `companyId` INTEGER NOT NULL DEFAULT 1,
    `userId` INTEGER NOT NULL,
    `summary` JSON NOT NULL,
    `payloadEnc` TEXT NULL,
    `proofFileId` INTEGER NULL,
    `status` ENUM('PENDING', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'PENDING',
    `decidedById` INTEGER NULL,
    `decidedAt` DATETIME(3) NULL,
    `reason` VARCHAR(500) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ChangeRequest_status_idx`(`status`),
    INDEX `ChangeRequest_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `UserHistory` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `companyId` INTEGER NOT NULL DEFAULT 1,
    `userId` INTEGER NOT NULL,
    `actorId` INTEGER NOT NULL,
    `field` VARCHAR(191) NOT NULL,
    `oldValue` VARCHAR(191) NULL,
    `newValue` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `UserHistory_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Session` (
    `id` VARCHAR(191) NOT NULL,
    `companyId` INTEGER NOT NULL DEFAULT 1,
    `userId` INTEGER NOT NULL,
    `userAgent` VARCHAR(255) NULL,
    `ip` VARCHAR(191) NULL,
    `remember` BOOLEAN NOT NULL DEFAULT false,
    `impersonatorId` INTEGER NULL,
    `expiresAt` DATETIME(3) NULL,
    `lastSeenAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `revokedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Session_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Attendance` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `companyId` INTEGER NOT NULL DEFAULT 1,
    `userId` INTEGER NOT NULL,
    `date` DATE NOT NULL,
    `checkIn` DATETIME(3) NOT NULL,
    `checkOut` DATETIME(3) NULL,
    `openUserId` INTEGER NULL,
    `workedHours` DOUBLE NULL,
    `extraHours` DOUBLE NULL,
    `lateMinutes` INTEGER NOT NULL DEFAULT 0,
    `earlyMinutes` INTEGER NOT NULL DEFAULT 0,
    `source` ENUM('BUTTON', 'AUTO', 'ADMIN') NOT NULL DEFAULT 'BUTTON',
    `isEdited` BOOLEAN NOT NULL DEFAULT false,
    `autoClosed` BOOLEAN NOT NULL DEFAULT false,
    `reviewedAt` DATETIME(3) NULL,
    `idempotencyKey` VARCHAR(191) NULL,
    `checkOutKey` VARCHAR(191) NULL,
    `deletedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `Attendance_openUserId_key`(`openUserId`),
    UNIQUE INDEX `Attendance_idempotencyKey_key`(`idempotencyKey`),
    UNIQUE INDEX `Attendance_checkOutKey_key`(`checkOutKey`),
    INDEX `Attendance_userId_date_idx`(`userId`, `date`),
    INDEX `Attendance_date_idx`(`date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AttendanceEdit` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `companyId` INTEGER NOT NULL DEFAULT 1,
    `attendanceId` INTEGER NOT NULL,
    `editorId` INTEGER NOT NULL,
    `field` VARCHAR(191) NOT NULL,
    `oldValue` VARCHAR(191) NULL,
    `newValue` VARCHAR(191) NULL,
    `reason` VARCHAR(500) NOT NULL,
    `editedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `AttendanceEdit_attendanceId_idx`(`attendanceId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `MissedDayRequest` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `companyId` INTEGER NOT NULL DEFAULT 1,
    `userId` INTEGER NOT NULL,
    `date` DATE NOT NULL,
    `note` VARCHAR(500) NOT NULL,
    `status` ENUM('PENDING', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'PENDING',
    `decidedById` INTEGER NULL,
    `decidedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `MissedDayRequest_status_idx`(`status`),
    UNIQUE INDEX `MissedDayRequest_userId_date_key`(`userId`, `date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Project` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `companyId` INTEGER NOT NULL DEFAULT 1,
    `name` VARCHAR(191) NOT NULL,
    `departmentId` INTEGER NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Task` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `companyId` INTEGER NOT NULL DEFAULT 1,
    `projectId` INTEGER NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,

    INDEX `Task_projectId_idx`(`projectId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TimesheetLine` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `companyId` INTEGER NOT NULL DEFAULT 1,
    `userId` INTEGER NOT NULL,
    `date` DATE NOT NULL,
    `projectId` INTEGER NOT NULL,
    `taskId` INTEGER NOT NULL,
    `description` VARCHAR(500) NULL,
    `hours` DOUBLE NOT NULL DEFAULT 0,
    `state` ENUM('DRAFT', 'SUPERVISOR_OK', 'VALIDATED') NOT NULL DEFAULT 'DRAFT',
    `supervisorById` INTEGER NULL,
    `validatedById` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `TimesheetLine_date_idx`(`date`),
    INDEX `TimesheetLine_projectId_idx`(`projectId`),
    UNIQUE INDEX `TimesheetLine_userId_date_projectId_taskId_key`(`userId`, `date`, `projectId`, `taskId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TimerSession` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `companyId` INTEGER NOT NULL DEFAULT 1,
    `userId` INTEGER NOT NULL,
    `projectId` INTEGER NOT NULL,
    `taskId` INTEGER NOT NULL,
    `startedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `TimerSession_userId_key`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `LeaveType` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `companyId` INTEGER NOT NULL DEFAULT 1,
    `name` VARCHAR(191) NOT NULL,
    `colour` VARCHAR(191) NOT NULL DEFAULT '#E2744A',
    `requiresAllocation` BOOLEAN NOT NULL DEFAULT true,
    `approvalSteps` ENUM('NONE', 'SUPERVISOR', 'MANAGER', 'SUPERVISOR_MANAGER') NOT NULL DEFAULT 'SUPERVISOR_MANAGER',
    `attachmentAfterDays` INTEGER NULL,
    `halfDayAllowed` BOOLEAN NOT NULL DEFAULT true,
    `accrualPerMonth` DOUBLE NULL,
    `maxCarryOver` DOUBLE NULL,
    `carryExpiry` VARCHAR(191) NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `LeaveAllocation` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `companyId` INTEGER NOT NULL DEFAULT 1,
    `userId` INTEGER NOT NULL,
    `leaveTypeId` INTEGER NOT NULL,
    `days` DOUBLE NOT NULL,
    `kind` ENUM('GRANT', 'ACCRUAL', 'CARRY_OVER', 'EXPIRY') NOT NULL DEFAULT 'GRANT',
    `note` VARCHAR(191) NULL,
    `periodStart` DATE NOT NULL,
    `periodEnd` DATE NOT NULL,
    `createdById` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `LeaveAllocation_userId_leaveTypeId_idx`(`userId`, `leaveTypeId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `LeaveRequest` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `companyId` INTEGER NOT NULL DEFAULT 1,
    `userId` INTEGER NOT NULL,
    `leaveTypeId` INTEGER NOT NULL,
    `dateFrom` DATE NOT NULL,
    `dateTo` DATE NOT NULL,
    `halfDay` BOOLEAN NOT NULL DEFAULT false,
    `days` DOUBLE NOT NULL,
    `reason` VARCHAR(500) NULL,
    `attachmentId` INTEGER NULL,
    `state` ENUM('DRAFT', 'SUBMITTED', 'SUPERVISOR_APPROVED', 'APPROVED', 'REFUSED', 'CANCELLED') NOT NULL DEFAULT 'SUBMITTED',
    `step1ById` INTEGER NULL,
    `step1At` DATETIME(3) NULL,
    `finalById` INTEGER NULL,
    `finalAt` DATETIME(3) NULL,
    `refusedById` INTEGER NULL,
    `refuseReason` VARCHAR(500) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `LeaveRequest_userId_state_idx`(`userId`, `state`),
    INDEX `LeaveRequest_dateFrom_dateTo_idx`(`dateFrom`, `dateTo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Notification` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `companyId` INTEGER NOT NULL DEFAULT 1,
    `userId` INTEGER NOT NULL,
    `type` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `body` VARCHAR(1000) NULL,
    `link` VARCHAR(191) NULL,
    `payload` JSON NULL,
    `readAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Notification_userId_readAt_idx`(`userId`, `readAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AuditLog` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `companyId` INTEGER NOT NULL DEFAULT 1,
    `actorId` INTEGER NULL,
    `actorName` VARCHAR(191) NULL,
    `entity` VARCHAR(191) NOT NULL,
    `entityId` VARCHAR(191) NULL,
    `action` VARCHAR(191) NOT NULL,
    `before` JSON NULL,
    `after` JSON NULL,
    `ip` VARCHAR(191) NULL,
    `at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `AuditLog_entity_entityId_idx`(`entity`, `entityId`),
    INDEX `AuditLog_at_idx`(`at`),
    INDEX `AuditLog_actorId_idx`(`actorId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Wish` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `companyId` INTEGER NOT NULL DEFAULT 1,
    `fromId` INTEGER NOT NULL,
    `toId` INTEGER NOT NULL,
    `year` INTEGER NOT NULL,
    `message` VARCHAR(500) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Wish_toId_year_idx`(`toId`, `year`),
    UNIQUE INDEX `Wish_fromId_toId_year_key`(`fromId`, `toId`, `year`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `FileObject` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `companyId` INTEGER NOT NULL DEFAULT 1,
    `ownerId` INTEGER NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `mime` VARCHAR(191) NOT NULL,
    `size` INTEGER NOT NULL,
    `storageKey` VARCHAR(191) NOT NULL,
    `purpose` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `FileObject_storageKey_key`(`storageKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Conversation` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `companyId` INTEGER NOT NULL DEFAULT 1,
    `type` ENUM('DIRECT', 'GROUP', 'CHANNEL', 'BOT') NOT NULL,
    `channelKind` ENUM('DEPARTMENT', 'GENERAL', 'ANNOUNCEMENTS') NULL,
    `name` VARCHAR(191) NULL,
    `departmentId` INTEGER NULL,
    `directKey` VARCHAR(191) NULL,
    `createdById` INTEGER NULL,
    `lastMessageAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `Conversation_departmentId_key`(`departmentId`),
    UNIQUE INDEX `Conversation_directKey_key`(`directKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ConversationMember` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `companyId` INTEGER NOT NULL DEFAULT 1,
    `conversationId` INTEGER NOT NULL,
    `userId` INTEGER NOT NULL,
    `lastReadAt` DATETIME(3) NULL,
    `joinedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ConversationMember_userId_idx`(`userId`),
    UNIQUE INDEX `ConversationMember_conversationId_userId_key`(`conversationId`, `userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Message` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `companyId` INTEGER NOT NULL DEFAULT 1,
    `conversationId` INTEGER NOT NULL,
    `senderId` INTEGER NULL,
    `clientId` VARCHAR(191) NULL,
    `body` TEXT NULL,
    `attachmentId` INTEGER NULL,
    `link` VARCHAR(191) NULL,
    `pinnedAt` DATETIME(3) NULL,
    `pinnedById` INTEGER NULL,
    `editedAt` DATETIME(3) NULL,
    `deletedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `Message_clientId_key`(`clientId`),
    INDEX `Message_conversationId_createdAt_idx`(`conversationId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CalendarConnection` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `companyId` INTEGER NOT NULL DEFAULT 1,
    `userId` INTEGER NOT NULL,
    `provider` ENUM('GOOGLE', 'MICROSOFT') NOT NULL,
    `accountEmail` VARCHAR(191) NULL,
    `refreshEnc` TEXT NOT NULL,
    `status` ENUM('CONNECTED', 'RECONNECT') NOT NULL DEFAULT 'CONNECTED',
    `syncToken` TEXT NULL,
    `channelId` VARCHAR(191) NULL,
    `channelResource` VARCHAR(191) NULL,
    `channelExpiry` DATETIME(3) NULL,
    `lastSyncAt` DATETIME(3) NULL,
    `lastError` VARCHAR(500) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `CalendarConnection_channelId_key`(`channelId`),
    UNIQUE INDEX `CalendarConnection_userId_provider_key`(`userId`, `provider`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SyncedEvent` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `companyId` INTEGER NOT NULL DEFAULT 1,
    `connectionId` INTEGER NOT NULL,
    `userId` INTEGER NOT NULL,
    `externalId` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `startAt` DATETIME(3) NOT NULL,
    `endAt` DATETIME(3) NOT NULL,
    `allDay` BOOLEAN NOT NULL DEFAULT false,
    `location` VARCHAR(500) NULL,
    `meetingUrl` VARCHAR(1000) NULL,
    `attendeeCount` INTEGER NOT NULL DEFAULT 0,
    `isPrivate` BOOLEAN NOT NULL DEFAULT false,

    INDEX `SyncedEvent_userId_startAt_idx`(`userId`, `startAt`),
    UNIQUE INDEX `SyncedEvent_connectionId_externalId_key`(`connectionId`, `externalId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CompanyEvent` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `companyId` INTEGER NOT NULL DEFAULT 1,
    `title` VARCHAR(191) NOT NULL,
    `description` VARCHAR(1000) NULL,
    `startAt` DATETIME(3) NOT NULL,
    `endAt` DATETIME(3) NOT NULL,
    `location` VARCHAR(191) NULL,
    `meetingUrl` VARCHAR(1000) NULL,
    `audience` VARCHAR(191) NOT NULL DEFAULT 'PEOPLE',
    `departmentId` INTEGER NULL,
    `attendeeIds` JSON NULL,
    `createdById` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `CompanyEvent_startAt_idx`(`startAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `RolePermission` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `companyId` INTEGER NOT NULL DEFAULT 1,
    `role` ENUM('EMPLOYEE', 'SUPERVISOR', 'MANAGER', 'ADMIN', 'SUPER_ADMIN') NOT NULL,
    `key` VARCHAR(191) NOT NULL,
    `allowed` BOOLEAN NOT NULL,

    UNIQUE INDEX `RolePermission_companyId_role_key_key`(`companyId`, `role`, `key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `EmailTemplate` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `companyId` INTEGER NOT NULL DEFAULT 1,
    `key` VARCHAR(191) NOT NULL,
    `subject` VARCHAR(191) NOT NULL,
    `body` TEXT NOT NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `EmailTemplate_companyId_key_key`(`companyId`, `key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `EmailJob` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `companyId` INTEGER NOT NULL DEFAULT 1,
    `toEmail` VARCHAR(191) NOT NULL,
    `toName` VARCHAR(191) NULL,
    `subject` VARCHAR(191) NOT NULL,
    `htmlEnc` LONGTEXT NOT NULL,
    `kind` VARCHAR(191) NOT NULL,
    `userId` INTEGER NULL,
    `status` ENUM('PENDING', 'SENT', 'FAILED', 'BOUNCED') NOT NULL DEFAULT 'PENDING',
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `nextAttempt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `providerId` VARCHAR(191) NULL,
    `lastError` VARCHAR(500) NULL,
    `sentAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `EmailJob_providerId_key`(`providerId`),
    INDEX `EmailJob_status_nextAttempt_idx`(`status`, `nextAttempt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Integration` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `companyId` INTEGER NOT NULL DEFAULT 1,
    `provider` VARCHAR(191) NOT NULL,
    `configEnc` TEXT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Integration_companyId_provider_key`(`companyId`, `provider`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `MetricBucket` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `bucketAt` DATETIME(3) NOT NULL,
    `requests` INTEGER NOT NULL DEFAULT 0,
    `errors` INTEGER NOT NULL DEFAULT 0,
    `p95Ms` INTEGER NOT NULL DEFAULT 0,
    `checkInP95Ms` INTEGER NOT NULL DEFAULT 0,

    UNIQUE INDEX `MetricBucket_bucketAt_key`(`bucketAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ErrorLog` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `endpoint` VARCHAR(191) NOT NULL,
    `message` VARCHAR(1000) NOT NULL,
    `status` INTEGER NOT NULL,
    `count` INTEGER NOT NULL DEFAULT 1,
    `lastAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ErrorLog_lastAt_idx`(`lastAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SecurityEvent` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `companyId` INTEGER NOT NULL DEFAULT 1,
    `type` VARCHAR(191) NOT NULL,
    `userId` INTEGER NULL,
    `email` VARCHAR(191) NULL,
    `ip` VARCHAR(191) NULL,
    `detail` VARCHAR(500) NULL,
    `at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `SecurityEvent_type_at_idx`(`type`, `at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `JobRun` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `startedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `endedAt` DATETIME(3) NULL,
    `ok` BOOLEAN NULL,
    `detail` VARCHAR(500) NULL,

    INDEX `JobRun_name_startedAt_idx`(`name`, `startedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Alert` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `key` VARCHAR(191) NOT NULL,
    `service` VARCHAR(191) NOT NULL,
    `message` VARCHAR(500) NOT NULL,
    `status` ENUM('OPEN', 'ACKNOWLEDGED', 'RESOLVED') NOT NULL DEFAULT 'OPEN',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `ackById` INTEGER NULL,
    `ackAt` DATETIME(3) NULL,
    `resolvedAt` DATETIME(3) NULL,

    INDEX `Alert_status_idx`(`status`),
    INDEX `Alert_key_status_idx`(`key`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `BackupRun` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `startedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `endedAt` DATETIME(3) NULL,
    `ok` BOOLEAN NULL,
    `sizeBytes` BIGINT NULL,
    `fileName` VARCHAR(191) NULL,
    `detail` VARCHAR(500) NULL,
    `triggeredBy` INTEGER NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DataRequest` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `companyId` INTEGER NOT NULL DEFAULT 1,
    `userId` INTEGER NOT NULL,
    `kind` VARCHAR(191) NOT NULL,
    `reason` VARCHAR(500) NULL,
    `requestedById` INTEGER NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'PENDING',
    `fileId` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `completedAt` DATETIME(3) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Department` ADD CONSTRAINT `Department_managerId_fkey` FOREIGN KEY (`managerId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `User` ADD CONSTRAINT `User_departmentId_fkey` FOREIGN KEY (`departmentId`) REFERENCES `Department`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `User` ADD CONSTRAINT `User_managerId_fkey` FOREIGN KEY (`managerId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `User` ADD CONSTRAINT `User_supervisorId_fkey` FOREIGN KEY (`supervisorId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `User` ADD CONSTRAINT `User_scheduleId_fkey` FOREIGN KEY (`scheduleId`) REFERENCES `WorkSchedule`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Profile` ADD CONSTRAINT `Profile_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Session` ADD CONSTRAINT `Session_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Attendance` ADD CONSTRAINT `Attendance_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AttendanceEdit` ADD CONSTRAINT `AttendanceEdit_attendanceId_fkey` FOREIGN KEY (`attendanceId`) REFERENCES `Attendance`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Project` ADD CONSTRAINT `Project_departmentId_fkey` FOREIGN KEY (`departmentId`) REFERENCES `Department`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Task` ADD CONSTRAINT `Task_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `Project`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TimesheetLine` ADD CONSTRAINT `TimesheetLine_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TimesheetLine` ADD CONSTRAINT `TimesheetLine_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `Project`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TimesheetLine` ADD CONSTRAINT `TimesheetLine_taskId_fkey` FOREIGN KEY (`taskId`) REFERENCES `Task`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TimerSession` ADD CONSTRAINT `TimerSession_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TimerSession` ADD CONSTRAINT `TimerSession_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `Project`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TimerSession` ADD CONSTRAINT `TimerSession_taskId_fkey` FOREIGN KEY (`taskId`) REFERENCES `Task`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LeaveAllocation` ADD CONSTRAINT `LeaveAllocation_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LeaveAllocation` ADD CONSTRAINT `LeaveAllocation_leaveTypeId_fkey` FOREIGN KEY (`leaveTypeId`) REFERENCES `LeaveType`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LeaveRequest` ADD CONSTRAINT `LeaveRequest_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LeaveRequest` ADD CONSTRAINT `LeaveRequest_leaveTypeId_fkey` FOREIGN KEY (`leaveTypeId`) REFERENCES `LeaveType`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LeaveRequest` ADD CONSTRAINT `LeaveRequest_step1ById_fkey` FOREIGN KEY (`step1ById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LeaveRequest` ADD CONSTRAINT `LeaveRequest_finalById_fkey` FOREIGN KEY (`finalById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Notification` ADD CONSTRAINT `Notification_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ConversationMember` ADD CONSTRAINT `ConversationMember_conversationId_fkey` FOREIGN KEY (`conversationId`) REFERENCES `Conversation`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ConversationMember` ADD CONSTRAINT `ConversationMember_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Message` ADD CONSTRAINT `Message_conversationId_fkey` FOREIGN KEY (`conversationId`) REFERENCES `Conversation`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CalendarConnection` ADD CONSTRAINT `CalendarConnection_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SyncedEvent` ADD CONSTRAINT `SyncedEvent_connectionId_fkey` FOREIGN KEY (`connectionId`) REFERENCES `CalendarConnection`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
