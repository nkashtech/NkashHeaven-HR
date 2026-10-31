-- HR can edit roles too (the owner role and company-wide scope stay with the company admin).
UPDATE `AccessRole` SET `permissions` = JSON_ARRAY_APPEND(`permissions`, '$', 'roles.manage')
  WHERE `name` = 'HR' AND `isSystem` = false AND NOT JSON_CONTAINS(`permissions`, '"roles.manage"');
