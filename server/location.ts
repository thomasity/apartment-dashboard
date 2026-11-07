// The apartment's coordinates, shared by weather, circadian and sunrise/sunset rules.
// LAT/LON win; LATITUDE/LONGITUDE are the names weather originally read.
export const LAT = parseFloat(process.env.LAT ?? process.env.LATITUDE ?? '') || 38.627;
export const LON = parseFloat(process.env.LON ?? process.env.LONGITUDE ?? '') || -90.1994;
