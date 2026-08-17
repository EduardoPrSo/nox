export type ProductSession = {
  accessToken: string;
  user: { id: string; displayName: string; email: string };
};

export interface SessionProvider {
  getSession(): Promise<ProductSession | null>;
  refreshSession(): Promise<ProductSession | null>;
  signOut(): Promise<void>;
}

export const mockSession: ProductSession = {
  accessToken: 'mock-only-never-sent',
  user: {
    id: 'mock-user',
    displayName: 'Eduardo',
    email: 'eduardo@example.invalid',
  },
};

export function isProtectedProductRoute(pathname: string): boolean {
  return !pathname.startsWith('/auth') && pathname !== '/offline';
}
