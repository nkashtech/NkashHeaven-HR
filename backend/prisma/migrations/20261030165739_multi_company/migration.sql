-- DropIndex
DROP INDEX `Payslip_number_key` ON `Payslip`;

-- DropIndex
DROP INDEX `Project_externalId_key` ON `Project`;

-- DropIndex
DROP INDEX `Task_externalId_key` ON `Task`;

-- DropIndex
DROP INDEX `User_email_key` ON `User`;

-- DropIndex
DROP INDEX `User_employeeNo_key` ON `User`;

-- AlterTable
ALTER TABLE `Activity` ALTER COLUMN `companyId` DROP DEFAULT;

-- AlterTable
ALTER TABLE `Appraisal` ALTER COLUMN `companyId` DROP DEFAULT;

-- AlterTable
ALTER TABLE `AppraisalGoal` ALTER COLUMN `companyId` DROP DEFAULT;

-- AlterTable
ALTER TABLE `Attendance` ALTER COLUMN `companyId` DROP DEFAULT,
    MODIFY `source` ENUM('BUTTON', 'CARD', 'AUTO', 'ADMIN') NOT NULL DEFAULT 'BUTTON';

-- AlterTable
ALTER TABLE `AttendanceEdit` ALTER COLUMN `companyId` DROP DEFAULT;

-- AlterTable
ALTER TABLE `AuditLog` ALTER COLUMN `companyId` DROP DEFAULT;

-- AlterTable
ALTER TABLE `CalendarConnection` ALTER COLUMN `companyId` DROP DEFAULT;

-- AlterTable
ALTER TABLE `ChangeRequest` ALTER COLUMN `companyId` DROP DEFAULT;

-- AlterTable
ALTER TABLE `ChatterEntry` ALTER COLUMN `companyId` DROP DEFAULT;

-- AlterTable
ALTER TABLE `Company` ADD COLUMN `active` BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN `isPlatform` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `slug` VARCHAR(191) NOT NULL;

-- AlterTable
ALTER TABLE `CompanyEvent` ALTER COLUMN `companyId` DROP DEFAULT;

-- AlterTable
ALTER TABLE `Contract` ALTER COLUMN `companyId` DROP DEFAULT;

-- AlterTable
ALTER TABLE `Conversation` ALTER COLUMN `companyId` DROP DEFAULT;

-- AlterTable
ALTER TABLE `ConversationMember` ALTER COLUMN `companyId` DROP DEFAULT;

-- AlterTable
ALTER TABLE `DataRequest` ALTER COLUMN `companyId` DROP DEFAULT;

-- AlterTable
ALTER TABLE `Department` ALTER COLUMN `companyId` DROP DEFAULT;

-- AlterTable
ALTER TABLE `EmailJob` ALTER COLUMN `companyId` DROP DEFAULT;

-- AlterTable
ALTER TABLE `EmailTemplate` ADD COLUMN `design` JSON NULL,
    ALTER COLUMN `companyId` DROP DEFAULT;

-- AlterTable
ALTER TABLE `FileObject` ALTER COLUMN `companyId` DROP DEFAULT;

-- AlterTable
ALTER TABLE `Integration` ALTER COLUMN `companyId` DROP DEFAULT;

-- AlterTable
ALTER TABLE `JobRun` ADD COLUMN `scopeId` INTEGER NULL;

-- AlterTable
ALTER TABLE `LeaveAllocation` ALTER COLUMN `companyId` DROP DEFAULT;

-- AlterTable
ALTER TABLE `LeaveRequest` ADD COLUMN `stepIndex` INTEGER NOT NULL DEFAULT 0,
    ALTER COLUMN `companyId` DROP DEFAULT;

-- AlterTable
ALTER TABLE `LeaveType` ADD COLUMN `workflowId` INTEGER NULL,
    ALTER COLUMN `companyId` DROP DEFAULT;

-- AlterTable
ALTER TABLE `Message` ALTER COLUMN `companyId` DROP DEFAULT;

-- AlterTable
ALTER TABLE `MissedDayRequest` ALTER COLUMN `companyId` DROP DEFAULT;

-- AlterTable
ALTER TABLE `Notification` ALTER COLUMN `companyId` DROP DEFAULT;

-- AlterTable
ALTER TABLE `PayrollRun` ALTER COLUMN `companyId` DROP DEFAULT;

-- AlterTable
ALTER TABLE `Payslip` ALTER COLUMN `companyId` DROP DEFAULT;

-- AlterTable
ALTER TABLE `Profile` ADD COLUMN `bloodGroup` VARCHAR(191) NULL,
    ADD COLUMN `city` VARCHAR(191) NULL,
    ADD COLUMN `contactNumber` VARCHAR(191) NULL,
    ADD COLUMN `country` VARCHAR(191) NULL,
    ADD COLUMN `dependents` JSON NULL,
    ADD COLUMN `emergencyEmail` VARCHAR(191) NULL,
    ADD COLUMN `firstName` VARCHAR(191) NULL,
    ADD COLUMN `gender` VARCHAR(191) NULL,
    ADD COLUMN `homePhone` VARCHAR(191) NULL,
    ADD COLUMN `idExpiry` DATE NULL,
    ADD COLUMN `lastName` VARCHAR(191) NULL,
    ADD COLUMN `maritalStatus` VARCHAR(191) NULL,
    ADD COLUMN `memberships` JSON NULL,
    ADD COLUMN `nationality` VARCHAR(191) NULL,
    ADD COLUMN `officePhone` VARCHAR(191) NULL,
    ADD COLUMN `passportNumberEnc` TEXT NULL,
    ADD COLUMN `permitExpiry` DATE NULL,
    ADD COLUMN `presentAddress` VARCHAR(500) NULL,
    ADD COLUMN `presentCity` VARCHAR(191) NULL,
    ADD COLUMN `presentContact` VARCHAR(191) NULL,
    ADD COLUMN `presentCountry` VARCHAR(191) NULL,
    ADD COLUMN `presentState` VARCHAR(191) NULL,
    ADD COLUMN `presentZip` VARCHAR(191) NULL,
    ADD COLUMN `pronoun` VARCHAR(191) NULL,
    ADD COLUMN `qualifications` JSON NULL,
    ADD COLUMN `race` VARCHAR(191) NULL,
    ADD COLUMN `religion` VARCHAR(191) NULL,
    ADD COLUMN `salutation` VARCHAR(191) NULL,
    ADD COLUMN `signatureFileId` INTEGER NULL,
    ADD COLUMN `state` VARCHAR(191) NULL,
    ADD COLUMN `workExperience` JSON NULL,
    ADD COLUMN `zipCode` VARCHAR(191) NULL,
    ALTER COLUMN `companyId` DROP DEFAULT;

-- AlterTable
ALTER TABLE `ProfileChange` ALTER COLUMN `companyId` DROP DEFAULT;

-- AlterTable
ALTER TABLE `Project` ALTER COLUMN `companyId` DROP DEFAULT;

-- AlterTable
ALTER TABLE `ProjectStage` ALTER COLUMN `companyId` DROP DEFAULT;

-- AlterTable
ALTER TABLE `PublicHoliday` ALTER COLUMN `companyId` DROP DEFAULT;

-- AlterTable
ALTER TABLE `RiskItem` ALTER COLUMN `companyId` DROP DEFAULT;

-- AlterTable
ALTER TABLE `SalaryRule` ALTER COLUMN `companyId` DROP DEFAULT;

-- AlterTable
ALTER TABLE `SecurityEvent` ALTER COLUMN `companyId` DROP DEFAULT;

-- AlterTable
ALTER TABLE `Session` ALTER COLUMN `companyId` DROP DEFAULT;

-- AlterTable
ALTER TABLE `SyncedEvent` ALTER COLUMN `companyId` DROP DEFAULT;

-- AlterTable
ALTER TABLE `Task` ALTER COLUMN `companyId` DROP DEFAULT;

-- AlterTable
ALTER TABLE `TaskStage` ALTER COLUMN `companyId` DROP DEFAULT;

-- AlterTable
ALTER TABLE `Team` ALTER COLUMN `companyId` DROP DEFAULT;

-- AlterTable
ALTER TABLE `TimerSession` ALTER COLUMN `companyId` DROP DEFAULT;

-- AlterTable
ALTER TABLE `TimesheetLine` ADD COLUMN `stepIndex` INTEGER NOT NULL DEFAULT 0,
    ALTER COLUMN `companyId` DROP DEFAULT;

-- AlterTable
ALTER TABLE `User` ADD COLUMN `accessRoleId` INTEGER NULL,
    ADD COLUMN `cardToken` VARCHAR(191) NULL,
    ADD COLUMN `lastCardScanAt` DATETIME(3) NULL,
    ALTER COLUMN `companyId` DROP DEFAULT;

-- AlterTable
ALTER TABLE `UserHistory` ALTER COLUMN `companyId` DROP DEFAULT;

-- AlterTable
ALTER TABLE `Wish` ALTER COLUMN `companyId` DROP DEFAULT;

-- AlterTable
ALTER TABLE `WorkSchedule` ALTER COLUMN `companyId` DROP DEFAULT;

-- DropTable
DROP TABLE `RolePermission`;

-- CreateTable
CREATE TABLE `AccessRole` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `companyId` INTEGER NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` VARCHAR(300) NULL,
    `scope` VARCHAR(191) NOT NULL DEFAULT 'SELF',
    `permissions` JSON NOT NULL,
    `isSystem` BOOLEAN NOT NULL DEFAULT false,

    UNIQUE INDEX `AccessRole_companyId_name_key`(`companyId`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Workflow` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `companyId` INTEGER NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `appliesTo` VARCHAR(191) NOT NULL,
    `steps` JSON NOT NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,

    UNIQUE INDEX `Workflow_companyId_name_key`(`companyId`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `EmployeeDocument` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `companyId` INTEGER NOT NULL,
    `userId` INTEGER NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `category` VARCHAR(191) NULL,
    `fileId` INTEGER NOT NULL,
    `expiresOn` DATE NULL,
    `createdById` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `EmployeeDocument_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE UNIQUE INDEX `Company_slug_key` ON `Company`(`slug`);

-- CreateIndex
CREATE UNIQUE INDEX `Payslip_companyId_number_key` ON `Payslip`(`companyId`, `number`);

-- CreateIndex
CREATE UNIQUE INDEX `Project_companyId_externalId_key` ON `Project`(`companyId`, `externalId`);

-- CreateIndex
CREATE UNIQUE INDEX `Task_companyId_externalId_key` ON `Task`(`companyId`, `externalId`);

-- CreateIndex
CREATE UNIQUE INDEX `User_cardToken_key` ON `User`(`cardToken`);

-- CreateIndex
CREATE UNIQUE INDEX `User_companyId_email_key` ON `User`(`companyId`, `email`);

-- CreateIndex
CREATE UNIQUE INDEX `User_companyId_employeeNo_key` ON `User`(`companyId`, `employeeNo`);

-- AddForeignKey
ALTER TABLE `User` ADD CONSTRAINT `User_accessRoleId_fkey` FOREIGN KEY (`accessRoleId`) REFERENCES `AccessRole`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

