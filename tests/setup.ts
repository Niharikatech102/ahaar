// The test suite must stay fast, deterministic, and offline. A locally
// configured Groq key in .env should never make automated tests depend on a
// live network call - this runs before any test file imports src/config.ts,
// and process.loadEnvFile() never overrides an already-set variable.
process.env.GROQ_API_KEY = '';
