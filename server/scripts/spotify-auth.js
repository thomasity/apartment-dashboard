// One-time Spotify OAuth setup.
// Run with: node server/scripts/spotify-auth.js
// Works from any machine — no local server required.

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const axios    = require('axios');
const readline = require('readline');

const CLIENT_ID     = process.env.SPOTIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;
const REDIRECT_URI  = 'http://127.0.0.1:3001/api/spotify/callback';
const SCOPES        = 'user-read-playback-state user-modify-playback-state user-read-currently-playing playlist-read-private playlist-read-collaborative';

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('\nMissing SPOTIFY_CLIENT_ID or SPOTIFY_CLIENT_SECRET in .env\n');
  process.exit(1);
}

const authUrl = 'https://accounts.spotify.com/authorize?' + new URLSearchParams({
  response_type: 'code',
  client_id:     CLIENT_ID,
  scope:         SCOPES,
  redirect_uri:  REDIRECT_URI,
  state:         Math.random().toString(36).substring(7),
});

console.log('\n🎵  Spotify Auth Setup');
console.log('======================\n');
console.log('1. Open this URL in any browser:\n');
console.log('   ' + authUrl);
console.log('\n2. Log in and authorize the app.');
console.log('\n3. Your browser will redirect to a URL that fails to load — that\'s expected.');
console.log('   Copy the full URL from the address bar.\n');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
rl.question('4. Paste the full redirect URL here: ', async (input) => {
  rl.close();

  let code;
  try {
    code = new URL(input.trim()).searchParams.get('code');
  } catch {
    console.error('\nCould not parse URL. Make sure you pasted the full address bar URL.\n');
    process.exit(1);
  }

  if (!code) {
    console.error('\nNo "code" parameter found in the URL.\n');
    process.exit(1);
  }

  try {
    const { data } = await axios.post(
      'https://accounts.spotify.com/api/token',
      new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT_URI }),
      {
        headers: {
          'Content-Type':  'application/x-www-form-urlencoded',
          Authorization: `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')}`,
        },
      }
    );

    console.log('\n✅  Success! Add this to your .env:\n');
    console.log(`SPOTIFY_REFRESH_TOKEN=${data.refresh_token}\n`);
  } catch (err) {
    console.error('\nToken exchange failed:', err.response?.data ?? err.message, '\n');
    process.exit(1);
  }
});
