-- Per-person access on top of their role.
ALTER TABLE `User` ADD COLUMN `permissionOverrides` JSON NULL;

-- Company admins and HR can open Timesheets to see everyone's.
UPDATE `AccessRole` SET `permissions` = JSON_ARRAY_APPEND(`permissions`, '$', 'module.timesheets')
  WHERE `isSystem` = true AND NOT JSON_CONTAINS(`permissions`, '"module.timesheets"');

-- Every company gets an HR role: the admin's access without managing roles.
INSERT INTO `AccessRole` (`companyId`, `name`, `description`, `scope`, `permissions`, `isSystem`)
  SELECT o.`companyId`, 'HR', 'Runs people, leave and payroll', 'COMPANY',
         JSON_REMOVE(o.`permissions`, JSON_UNQUOTE(JSON_SEARCH(o.`permissions`, 'one', 'roles.manage'))), false
  FROM `AccessRole` o
  WHERE o.`isSystem` = true AND JSON_CONTAINS(o.`permissions`, '"roles.manage"')
    AND NOT EXISTS (SELECT 1 FROM `AccessRole` x WHERE x.`companyId` = o.`companyId` AND x.`name` = 'HR');
