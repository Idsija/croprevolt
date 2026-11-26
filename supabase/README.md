# Online leaderboard setup

The game works without this. Until the two settings below exist, it shows only the on-device board.

1. Create a free project at supabase.com.
2. Open **SQL Editor**, paste the contents of `schema.sql` and run it.
3. Open **Project Settings > API** and copy the **Project URL** and the **anon public** key.
4. Put them in a file named `.env.local` in the project root (it is git-ignored):

   ```
   VITE_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
   VITE_SUPABASE_ANON_KEY=YOUR-ANON-KEY
   ```

5. Restart `npm run dev`, or rebuild. If the game is deployed, add the same two settings to the host's build environment.

The anon key is meant to be public: the table's rules only let the game read scores and add new ones.

## Limits to know about

Scores are reported by the player's browser, so someone determined can post a made-up score. The table rejects impossible values and old daily dates, and you can delete rows in the Supabase table editor. Stopping cheating properly would need the server to replay each run, which this does not do.
