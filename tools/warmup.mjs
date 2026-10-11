const places = [
  'Shibuya Crossing, Tokyo, Japan',
  'Myeongdong, Seoul, South Korea',
  'Avenida Paulista, São Paulo, Brazil',
  'Khao San Road, Bangkok, Thailand',
  'Kalverstraat, Amsterdam, Netherlands',
];
const origin = process.env.TREKIT_ORIGIN || 'http://localhost:3000';

for (const place of places) {
  process.stdout.write(`Warming ${place}… `);
  try {
    const response = await fetch(`${origin}/api/world?place=${encodeURIComponent(place)}`);
    if (!response.ok) {
      console.log(`failed (${response.status})`);
      process.exitCode = 1;
      continue;
    }
    console.log('ready');
  } catch {
    console.log(`could not reach ${origin}`);
    process.exitCode = 1;
    console.error('Start the app first with `npm run dev`, or set TREKIT_ORIGIN to its URL.');
    break;
  }
}
