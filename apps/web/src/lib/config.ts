/** Public URLs of the services the browser talks to (inlined at build time). */
export const CORE_API_URL = process.env.NEXT_PUBLIC_CORE_API_URL ?? 'http://localhost:3001';
export const SIMULATOR_URL = process.env.NEXT_PUBLIC_SIMULATOR_URL ?? 'http://localhost:3003';
