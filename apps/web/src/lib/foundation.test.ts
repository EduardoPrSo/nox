import { mockSession, isProtectedProductRoute } from './auth';
import { mockConnections } from './mock-data';
import { desktopNavigation, mobileNavigation } from './navigation';

describe('product foundation', () => {
  it('keeps account identity out of route inputs and protects product routes', () => {
    expect(mockSession.user.id).toBe('mock-user');
    expect(isProtectedProductRoute('/chat')).toBe(true);
    expect(isProtectedProductRoute('/auth/login')).toBe(false);
    expect(isProtectedProductRoute('/offline')).toBe(false);
  });

  it('uses distinct desktop and touch-first mobile navigation', () => {
    expect(desktopNavigation.map((item) => item.label)).toContain('Connections');
    expect(mobileNavigation.map((item) => item.label)).toEqual([
      'Home',
      'Chat',
      'Voice',
      'Memory',
      'More',
    ]);
  });

  it('models connector capabilities independently from connection status', () => {
    const whatsapp = mockConnections.find((connector) => connector.id === 'whatsapp');
    expect(whatsapp?.status).toBe('WAITING_USER');
    expect(whatsapp?.capabilities.find((item) => item.id === 'messages.read')?.enabled).toBe(false);
  });
});
