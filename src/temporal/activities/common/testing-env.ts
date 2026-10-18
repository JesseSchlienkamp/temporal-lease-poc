// Imported first by testing.ts, before anything loads src/config.ts: points the activities at an
// in-memory database and at fake service URLs. Values already in the environment win over .env.
process.env.DB_PATH = ':memory:';
process.env.MOCK_SERVICES_URL = 'http://mocks.test';
process.env.AGENT_PAGE_URL = 'http://agent.test/agent';
