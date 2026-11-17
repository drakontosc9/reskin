/* Reskin settings.
   To turn on accounts + cloud saving, create a Supabase project (supabase.com, free tier),
   run supabase/schema.sql in its SQL editor, then paste the two values from
   Project Settings → API here. Both are designed to be public (the database rules in
   schema.sql make sure people can only read and change their own projects). */
window.RESKIN_CONFIG = {
  supabaseUrl: '',      // e.g. 'https://abcdefghijkl.supabase.co'
  supabaseAnonKey: '',  // the "anon" / "publishable" key
};
