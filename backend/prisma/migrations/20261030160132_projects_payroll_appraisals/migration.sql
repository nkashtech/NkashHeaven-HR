-- DropForeignKey
ALTER TABLE `TimerSession` DROP FOREIGN KEY `TimerSession_taskId_fkey`;

-- DropForeignKey
ALTER TABLE `TimesheetLine` DROP FOREIGN KEY `TimesheetLine_taskId_fkey`;

-- The foreign key on userId needs an index before the old unique one goes.
CREATE INDEX `TimesheetLine_userId_date_idx` ON `TimesheetLine`(`userId`, `date`);
DROP INDEX `TimesheetLine_userId_date_projectId_taskId_key` ON `TimesheetLine`;

-- AlterTable
ALTER TABLE `CalendarConnection` ADD COLUMN `pushLeave` BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE `LeaveRequest` ADD COLUMN `pushedEvents` JSON NULL;

-- AlterTable
ALTER TABLE `Project` ADD COLUMN `allocatedHours` DOUBLE NOT NULL DEFAULT 0,
    ADD COLUMN `billable` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `createdById` INTEGER NULL,
    ADD COLUMN `customer` VARCHAR(191) NULL,
    ADD COLUMN `description` TEXT NULL,
    ADD COLUMN `externalId` VARCHAR(191) NULL,
    ADD COLUMN `health` VARCHAR(191) NOT NULL DEFAULT 'on_track',
    ADD COLUMN `managerId` INTEGER NULL,
    ADD COLUMN `plannedEnd` DATE NULL,
    ADD COLUMN `plannedStart` DATE NULL,
    ADD COLUMN `stageId` INTEGER NULL,
    ADD COLUMN `tags` JSON NULL,
    ADD COLUMN `taskLabel` VARCHAR(191) NOT NULL DEFAULT 'Tasks';

-- AlterTable
ALTER TABLE `PublicHoliday` ADD COLUMN `kind` VARCHAR(191) NOT NULL DEFAULT 'PUBLIC';

-- AlterTable
ALTER TABLE `Task` ADD COLUMN `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    ADD COLUMN `createdById` INTEGER NULL,
    ADD COLUMN `deadline` DATE NULL,
    ADD COLUMN `description` TEXT NULL,
    ADD COLUMN `externalId` VARCHAR(191) NULL,
    ADD COLUMN `parentId` INTEGER NULL,
    ADD COLUMN `plannedHours` DOUBLE NOT NULL DEFAULT 0,
    ADD COLUMN `priority` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `sequence` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `stageId` INTEGER NULL,
    ADD COLUMN `tags` JSON NULL,
    MODIFY `name` VARCHAR(500) NOT NULL;

-- AlterTable
ALTER TABLE `TimerSession` ADD COLUMN `assistedUserId` INTEGER NULL,
    ADD COLUMN `description` VARCHAR(500) NULL,
    MODIFY `taskId` INTEGER NULL;

-- AlterTable
ALTER TABLE `TimesheetLine` ADD COLUMN `assistedUserId` INTEGER NULL,
    MODIFY `taskId` INTEGER NULL;

-- AlterTable
ALTER TABLE `User` ADD COLUMN `lastDigestAt` DATETIME(3) NULL,
    ADD COLUMN `teamId` INTEGER NULL;

-- CreateTable
CREATE TABLE `Team` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `companyId` INTEGER NOT NULL DEFAULT 1,
    `name` VARCHAR(191) NOT NULL,
    `departmentId` INTEGER NULL,
    `leadId` INTEGER NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,

    UNIQUE INDEX `Team_companyId_name_key`(`companyId`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ProjectStage` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `companyId` INTEGER NOT NULL DEFAULT 1,
    `name` VARCHAR(191) NOT NULL,
    `sequence` INTEGER NOT NULL DEFAULT 0,
    `folded` BOOLEAN NOT NULL DEFAULT false,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ProjectFavorite` (
    `userId` INTEGER NOT NULL,
    `projectId` INTEGER NOT NULL,

    PRIMARY KEY (`userId`, `projectId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TaskStage` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `companyId` INTEGER NOT NULL DEFAULT 1,
    `projectId` INTEGER NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `sequence` INTEGER NOT NULL DEFAULT 0,
    `isDone` BOOLEAN NOT NULL DEFAULT false,

    INDEX `TaskStage_projectId_idx`(`projectId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TaskAssignee` (
    `taskId` INTEGER NOT NULL,
    `userId` INTEGER NOT NULL,

    PRIMARY KEY (`taskId`, `userId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `RiskItem` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `companyId` INTEGER NOT NULL DEFAULT 1,
    `projectId` INTEGER NOT NULL,
    `kind` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `severity` VARCHAR(191) NOT NULL DEFAULT 'MEDIUM',
    `status` VARCHAR(191) NOT NULL DEFAULT 'OPEN',
    `ownerId` INTEGER NULL,
    `dueDate` DATE NULL,
    `createdById` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `RiskItem_projectId_idx`(`projectId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ChatterEntry` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `companyId` INTEGER NOT NULL DEFAULT 1,
    `entity` VARCHAR(191) NOT NULL,
    `entityId` INTEGER NOT NULL,
    `authorId` INTEGER NULL,
    `kind` VARCHAR(191) NOT NULL DEFAULT 'MESSAGE',
    `body` TEXT NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ChatterEntry_entity_entityId_idx`(`entity`, `entityId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Activity` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `companyId` INTEGER NOT NULL DEFAULT 1,
    `entity` VARCHAR(191) NOT NULL,
    `entityId` INTEGER NOT NULL,
    `assigneeId` INTEGER NOT NULL,
    `summary` VARCHAR(191) NOT NULL,
    `dueDate` DATE NOT NULL,
    `doneAt` DATETIME(3) NULL,
    `createdById` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Activity_entity_entityId_idx`(`entity`, `entityId`),
    INDEX `Activity_assigneeId_doneAt_idx`(`assigneeId`, `doneAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Follower` (
    `entity` VARCHAR(191) NOT NULL,
    `entityId` INTEGER NOT NULL,
    `userId` INTEGER NOT NULL,

    PRIMARY KEY (`entity`, `entityId`, `userId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Contract` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `companyId` INTEGER NOT NULL DEFAULT 1,
    `userId` INTEGER NOT NULL,
    `reference` VARCHAR(191) NOT NULL,
    `contractType` VARCHAR(191) NOT NULL DEFAULT 'PERMANENT',
    `jobTitle` VARCHAR(191) NULL,
    `startDate` DATE NOT NULL,
    `endDate` DATE NULL,
    `probationEnd` DATE NULL,
    `workPermitNumber` VARCHAR(191) NULL,
    `workPermitExpiry` DATE NULL,
    `wage` DOUBLE NOT NULL,
    `state` VARCHAR(191) NOT NULL DEFAULT 'DRAFT',
    `notes` TEXT NULL,
    `documentFileId` INTEGER NULL,
    `createdById` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Contract_userId_state_idx`(`userId`, `state`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SalaryRule` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `companyId` INTEGER NOT NULL DEFAULT 1,
    `code` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `category` VARCHAR(191) NOT NULL,
    `amountType` VARCHAR(191) NOT NULL DEFAULT 'FIXED',
    `amount` DOUBLE NOT NULL DEFAULT 0,
    `sequence` INTEGER NOT NULL DEFAULT 10,
    `active` BOOLEAN NOT NULL DEFAULT true,

    UNIQUE INDEX `SalaryRule_companyId_code_key`(`companyId`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PayrollRun` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `companyId` INTEGER NOT NULL DEFAULT 1,
    `name` VARCHAR(191) NOT NULL,
    `periodStart` DATE NOT NULL,
    `periodEnd` DATE NOT NULL,
    `state` VARCHAR(191) NOT NULL DEFAULT 'DRAFT',
    `createdById` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `PayrollRun_companyId_periodStart_periodEnd_key`(`companyId`, `periodStart`, `periodEnd`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Payslip` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `companyId` INTEGER NOT NULL DEFAULT 1,
    `runId` INTEGER NOT NULL,
    `userId` INTEGER NOT NULL,
    `contractId` INTEGER NOT NULL,
    `number` VARCHAR(191) NOT NULL,
    `periodStart` DATE NOT NULL,
    `periodEnd` DATE NOT NULL,
    `workedDays` DOUBLE NOT NULL DEFAULT 0,
    `unpaidDays` DOUBLE NOT NULL DEFAULT 0,
    `gross` DOUBLE NOT NULL DEFAULT 0,
    `deductions` DOUBLE NOT NULL DEFAULT 0,
    `net` DOUBLE NOT NULL DEFAULT 0,
    `state` VARCHAR(191) NOT NULL DEFAULT 'DRAFT',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `Payslip_number_key`(`number`),
    UNIQUE INDEX `Payslip_runId_userId_key`(`runId`, `userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PayslipLine` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `payslipId` INTEGER NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `category` VARCHAR(191) NOT NULL,
    `amount` DOUBLE NOT NULL,
    `sequence` INTEGER NOT NULL DEFAULT 10,
    `manual` BOOLEAN NOT NULL DEFAULT false,

    INDEX `PayslipLine_payslipId_idx`(`payslipId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Appraisal` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `companyId` INTEGER NOT NULL DEFAULT 1,
    `userId` INTEGER NOT NULL,
    `managerId` INTEGER NOT NULL,
    `deadline` DATE NOT NULL,
    `state` VARCHAR(191) NOT NULL DEFAULT 'NEW',
    `employeeFeedback` TEXT NULL,
    `managerFeedback` TEXT NULL,
    `employeeDone` BOOLEAN NOT NULL DEFAULT false,
    `managerDone` BOOLEAN NOT NULL DEFAULT false,
    `rating` INTEGER NULL,
    `createdById` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Appraisal_userId_idx`(`userId`),
    INDEX `Appraisal_managerId_idx`(`managerId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AppraisalGoal` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `companyId` INTEGER NOT NULL DEFAULT 1,
    `userId` INTEGER NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `progress` INTEGER NOT NULL DEFAULT 0,
    `deadline` DATE NULL,
    `createdById` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `AppraisalGoal_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE UNIQUE INDEX `Project_externalId_key` ON `Project`(`externalId`);

-- CreateIndex
CREATE INDEX `Project_stageId_idx` ON `Project`(`stageId`);

-- CreateIndex
CREATE UNIQUE INDEX `Task_externalId_key` ON `Task`(`externalId`);

-- CreateIndex


-- AddForeignKey
ALTER TABLE `Team` ADD CONSTRAINT `Team_departmentId_fkey` FOREIGN KEY (`departmentId`) REFERENCES `Department`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Team` ADD CONSTRAINT `Team_leadId_fkey` FOREIGN KEY (`leadId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `User` ADD CONSTRAINT `User_teamId_fkey` FOREIGN KEY (`teamId`) REFERENCES `Team`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Project` ADD CONSTRAINT `Project_stageId_fkey` FOREIGN KEY (`stageId`) REFERENCES `ProjectStage`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Project` ADD CONSTRAINT `Project_managerId_fkey` FOREIGN KEY (`managerId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProjectFavorite` ADD CONSTRAINT `ProjectFavorite_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `Project`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TaskStage` ADD CONSTRAINT `TaskStage_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `Project`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Task` ADD CONSTRAINT `Task_stageId_fkey` FOREIGN KEY (`stageId`) REFERENCES `TaskStage`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Task` ADD CONSTRAINT `Task_parentId_fkey` FOREIGN KEY (`parentId`) REFERENCES `Task`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TaskAssignee` ADD CONSTRAINT `TaskAssignee_taskId_fkey` FOREIGN KEY (`taskId`) REFERENCES `Task`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TaskAssignee` ADD CONSTRAINT `TaskAssignee_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RiskItem` ADD CONSTRAINT `RiskItem_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `Project`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TimesheetLine` ADD CONSTRAINT `TimesheetLine_assistedUserId_fkey` FOREIGN KEY (`assistedUserId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TimesheetLine` ADD CONSTRAINT `TimesheetLine_taskId_fkey` FOREIGN KEY (`taskId`) REFERENCES `Task`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TimerSession` ADD CONSTRAINT `TimerSession_taskId_fkey` FOREIGN KEY (`taskId`) REFERENCES `Task`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Contract` ADD CONSTRAINT `Contract_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Payslip` ADD CONSTRAINT `Payslip_runId_fkey` FOREIGN KEY (`runId`) REFERENCES `PayrollRun`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Payslip` ADD CONSTRAINT `Payslip_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Payslip` ADD CONSTRAINT `Payslip_contractId_fkey` FOREIGN KEY (`contractId`) REFERENCES `Contract`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PayslipLine` ADD CONSTRAINT `PayslipLine_payslipId_fkey` FOREIGN KEY (`payslipId`) REFERENCES `Payslip`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Appraisal` ADD CONSTRAINT `Appraisal_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AppraisalGoal` ADD CONSTRAINT `AppraisalGoal_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

