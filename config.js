/* Reskin settings.
   To turn on accounts + cloud saving, create a Supabase project (supabase.com, free tier),
   run supabase/schema.sql in its SQL editor, then paste the two values from
   Project Settings → API here. Both are designed to be public (the database rules in
   schema.sql make sure people can only read and change their own projects). */
window.RESKIN_CONFIG = {
  supabaseUrl: 'https://fqwtezsbtaukdqtmxbeg.supabase.co',      // e.g. 'https://abcdefghijkl.supabase.co'
  supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZxd3RlenNidGF1a2RxdG14YmVnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ5NTMyNzcsImV4cCI6MjExMDUyOTI3N30.pHHFH6dmQeRs8wiDl0uU8bixg-SL2e0Dke1T4lYvGgQ',  // the "anon" / "publishable" key
};
