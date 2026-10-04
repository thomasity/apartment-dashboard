// Loads ../.env into process.env. Must be the first import in any entry point, since
// several modules read process.env at import time.
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env') });
