// Settings for the student app. No secrets belong in this file.
//
// While supabaseUrl is empty the app runs in TRIAL MODE: it reads the question bank from
// ../data/bank.js on this computer and keeps answers in this browser only.
// Once the Supabase project exists, fill in the project URL and the public key: the
// "publishable" key (sb_publishable_...), called the "anon" key on older projects.
// Both are safe to publish. The secret key (sb_secret_... / service_role) never goes here.
window.APP_CONFIG = {
  supabaseUrl: "https://raamvqmlcjvnwymqcepb.supabase.co",
  supabaseAnonKey: "sb_publishable_e_NC34VABS8X1cU-MWsOng_yeemJ_ba",
  // Students sign in with a username. Supabase needs an email address, so the app adds this
  // ending behind the scenes: "ethan" signs in as ethan@<usernameDomain>. No mail is ever sent to it.
  usernameDomain: "students.psle-bank.example",
};
