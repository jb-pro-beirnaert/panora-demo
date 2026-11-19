import { hashPassword, verifyPassword } from './password.js';
import { readCookie } from './sessions.service.js';

describe('passwords', () => {
  it('verifies the right password only, with a different salt each time', async () => {
    const hash = await hashPassword('demo-password');
    expect(hash).not.toEqual(await hashPassword('demo-password'));
    expect(await verifyPassword('demo-password', hash)).toBe(true);
    expect(await verifyPassword('wrong', hash)).toBe(false);
    expect(await verifyPassword('demo-password', null)).toBe(false);
  });
});

describe('readCookie', () => {
  it('reads one cookie from the header', () => {
    expect(readCookie('a=1; session=abc%3D; b=2', 'session')).toBe('abc=');
    expect(readCookie(undefined, 'session')).toBeNull();
  });
});
