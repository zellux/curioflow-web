// Replace only the Next.js request/session boundary; database and services stay real.
const authUrl = new URL("../src/server/auth.ts", import.meta.url).href;
const dbUrl = new URL("../src/server/db.ts", import.meta.url).href;
export async function resolve(specifier, context, nextResolve) {
  if (specifier === "@/server/auth") {
    const source = `
      export * from ${JSON.stringify(authUrl)};
      import { prisma } from ${JSON.stringify(dbUrl)};
      export async function getAuthenticatedUser() {
        return prisma.user.findUniqueOrThrow({ where: { id: 'service-user' } });
      }
      export const getCurrentUser = getAuthenticatedUser;
      export async function getCurrentLibrary() {
        return prisma.library.findUniqueOrThrow({ where: { id: 'service-library' } });
      }
    `;
    return { url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
