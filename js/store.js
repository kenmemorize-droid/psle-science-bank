// Picks the back end. Both hand the app the same functions:
//   currentUser, signIn, signOut, catalog, questionIndex, questions(ids),
//   attempts, addAttempt, queue, saveQueue, intervals
export async function makeStore(config) {
  const mod = config.supabaseUrl && config.supabaseAnonKey
    ? await import("./store-supabase.js")
    : await import("./store-local.js");
  return mod.createStore(config);
}
