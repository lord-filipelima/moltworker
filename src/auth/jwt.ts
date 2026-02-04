import { jwtVerify, createRemoteJWKSet, decodeJwt, type JWTPayload as JoseJWTPayload } from 'jose';
import type { JWTPayload } from '../types';

/**
 * Verify a Cloudflare Access JWT token using the jose library.
 *
 * This follows Cloudflare's recommended approach:
 * https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/#cloudflare-workers-example
 *
 * @param token - The JWT token string
 * @param teamDomain - The Cloudflare Access team domain (e.g., 'myteam.cloudflareaccess.com')
 * @param expectedAud - The expected audience (Application AUD tag)
 * @returns The decoded JWT payload if valid
 * @throws Error if the token is invalid, expired, or doesn't match expected values
 */
export async function verifyAccessJWT(
  token: string,
  teamDomain: string,
  expectedAud: string
): Promise<JWTPayload> {
  // Normalize teamDomain - remove https:// prefix and trailing slashes
  const normalizedDomain = teamDomain.replace(/^https?:\/\//, '').replace(/\/+$/, '');
  const expectedIssuer = `https://${normalizedDomain}`;

  // Create JWKS from the team domain
  const JWKS = createRemoteJWKSet(new URL(`${expectedIssuer}/cdn-cgi/access/certs`));

  // Verify the JWT signature and audience only (issuer check is manual for flexibility)
  const { payload } = await jwtVerify(token, JWKS, {
    audience: expectedAud,
  });

  // Manually verify issuer with normalization (handle trailing slashes)
  const actualIssuer = (payload.iss || '').replace(/\/+$/, '');
  if (actualIssuer !== expectedIssuer) {
    throw new Error(`Issuer mismatch: expected "${expectedIssuer}", got "${actualIssuer}"`);
  }

  // Cast to our JWTPayload type
  return payload as unknown as JWTPayload;
}
