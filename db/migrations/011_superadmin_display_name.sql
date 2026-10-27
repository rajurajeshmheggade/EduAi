-- Show the platform owner as "Super Admin" (login stays `superadmin`). Only renames the untouched default.
UPDATE public.app_users
   SET full_name = 'Super Admin'
 WHERE user_code = 'superadmin'
   AND user_role = 'superadmin'
   AND full_name = 'Platform Owner (SuperAdmin)';
