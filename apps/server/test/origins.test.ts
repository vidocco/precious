import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ADMIN, setupHousehold, startTestServer, TEST_DATABASE_URL, type TestServer } from './harness.ts';

/**
 * Requests that carry a session are checked against the address they come from, so a
 * household can use Precious at several addresses (IP, hostname, a proxy) at once.
 */
describe.runIf(TEST_DATABASE_URL)('using Precious from different addresses', () => {
  let server: TestServer;

  beforeAll(async () => {
    server = await startTestServer();
    await setupHousehold(server.app);
  });
  afterAll(async () => {
    await server?.close();
  });

  async function signedInRequest(host: string, origin: string) {
    const signIn = await server.app.inject({
      method: 'POST',
      url: '/api/auth/sign-in/email',
      headers: { host, origin: `http://${host}`, 'content-type': 'application/json' },
      payload: JSON.stringify({ email: ADMIN.email, password: ADMIN.password }),
    });
    const cookie = [signIn.headers['set-cookie']]
      .flat()
      .map((c) => String(c).split(';')[0])
      .join('; ');
    return server.app.inject({
      method: 'POST',
      url: '/api/auth/sign-out',
      headers: { host, origin, cookie, 'content-type': 'application/json' },
      payload: '{}',
    });
  }

  it('works at any address the server is reached at', async () => {
    expect((await signedInRequest('192.168.1.10:8080', 'http://192.168.1.10:8080')).statusCode).toBe(200);
    expect((await signedInRequest('tower.local:8080', 'http://tower.local:8080')).statusCode).toBe(200);
    expect((await signedInRequest('precious.example.com', 'https://precious.example.com')).statusCode).toBe(200);
  });

  it('refuses requests made from another site', async () => {
    expect((await signedInRequest('192.168.1.10:8080', 'http://evil.example')).statusCode).toBe(403);
  });
});
