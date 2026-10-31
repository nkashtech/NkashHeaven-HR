-- Supervisors are gone: a manager approves, then HR, or requests go straight to HR.

-- People with no manager keep the person who supervised them as their manager.
UPDATE `User` SET `managerId` = `supervisorId` WHERE `managerId` IS NULL AND `supervisorId` IS NOT NULL;

ALTER TABLE `User` DROP FOREIGN KEY `User_supervisorId_fkey`;
DROP INDEX `User_supervisorId_idx` ON `User`;
ALTER TABLE `User` DROP COLUMN `supervisorId`;

-- Supervisor roles fold into each company's Manager role, and "crew" scope becomes department scope.
UPDATE `User` u
  JOIN `AccessRole` s ON s.`id` = u.`accessRoleId` AND s.`name` = 'Supervisor'
  JOIN `AccessRole` m ON m.`companyId` = s.`companyId` AND m.`name` = 'Manager'
  SET u.`accessRoleId` = m.`id`;
DELETE s FROM `AccessRole` s
  JOIN `AccessRole` m ON m.`companyId` = s.`companyId` AND m.`name` = 'Manager'
  WHERE s.`name` = 'Supervisor' AND s.`isSystem` = false;
UPDATE `AccessRole` SET `scope` = 'DEPARTMENT' WHERE `scope` = 'TEAM';

ALTER TABLE `User` MODIFY `role` ENUM('EMPLOYEE', 'SUPERVISOR', 'MANAGER', 'ADMIN', 'SUPER_ADMIN') NOT NULL DEFAULT 'EMPLOYEE';
UPDATE `User` SET `role` = 'MANAGER' WHERE `role` = 'SUPERVISOR';
ALTER TABLE `User` MODIFY `role` ENUM('EMPLOYEE', 'MANAGER', 'ADMIN', 'SUPER_ADMIN') NOT NULL DEFAULT 'EMPLOYEE';

-- Leave types: supervisor + manager becomes manager + HR.
ALTER TABLE `LeaveType` MODIFY `approvalSteps` ENUM('NONE', 'SUPERVISOR', 'MANAGER', 'SUPERVISOR_MANAGER', 'HR', 'MANAGER_HR') NOT NULL DEFAULT 'MANAGER_HR';
UPDATE `LeaveType` SET `approvalSteps` = 'MANAGER' WHERE `approvalSteps` = 'SUPERVISOR';
UPDATE `LeaveType` SET `approvalSteps` = 'MANAGER_HR' WHERE `approvalSteps` = 'SUPERVISOR_MANAGER';
ALTER TABLE `LeaveType` MODIFY `approvalSteps` ENUM('NONE', 'MANAGER', 'HR', 'MANAGER_HR') NOT NULL DEFAULT 'MANAGER_HR';

-- Workflow steps that named the supervisor now name the manager.
UPDATE `Workflow` SET `steps` = CAST(REPLACE(CAST(`steps` AS CHAR), '"SUPERVISOR"', '"MANAGER"') AS JSON);

ALTER TABLE `LeaveRequest` MODIFY `state` ENUM('DRAFT', 'SUBMITTED', 'SUPERVISOR_APPROVED', 'PARTLY_APPROVED', 'APPROVED', 'REFUSED', 'CANCELLED') NOT NULL DEFAULT 'SUBMITTED';
UPDATE `LeaveRequest` SET `state` = 'PARTLY_APPROVED' WHERE `state` = 'SUPERVISOR_APPROVED';
ALTER TABLE `LeaveRequest` MODIFY `state` ENUM('DRAFT', 'SUBMITTED', 'PARTLY_APPROVED', 'APPROVED', 'REFUSED', 'CANCELLED') NOT NULL DEFAULT 'SUBMITTED';

ALTER TABLE `TimesheetLine` MODIFY `state` ENUM('DRAFT', 'SUPERVISOR_OK', 'PARTLY_VALIDATED', 'VALIDATED') NOT NULL DEFAULT 'DRAFT';
UPDATE `TimesheetLine` SET `state` = 'PARTLY_VALIDATED' WHERE `state` = 'SUPERVISOR_OK';
ALTER TABLE `TimesheetLine` MODIFY `state` ENUM('DRAFT', 'PARTLY_VALIDATED', 'VALIDATED') NOT NULL DEFAULT 'DRAFT';
ALTER TABLE `TimesheetLine` RENAME COLUMN `supervisorById` TO `step1ById`;
