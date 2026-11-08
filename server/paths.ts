import path from 'path';

// The server folder (where config.json and config.example.json live). Running from
// source this file is in server/; compiled for the Pi it's in server/dist/.
export const SERVER_DIR = path.basename(__dirname) === 'dist' ? path.dirname(__dirname) : __dirname;
