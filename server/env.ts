// Loads ../.env into process.env. Must be the first import in any entry point, since
// several modules read process.env at import time.
import dotenv from 'dotenv';
import path from 'path';
import { SERVER_DIR } from './paths';

dotenv.config({ path: path.resolve(SERVER_DIR, '../.env') });
