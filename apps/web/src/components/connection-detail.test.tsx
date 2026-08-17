import { fireEvent, render, screen } from '@testing-library/react';
import { ConnectionDetail } from './connection-detail';
import { mockConnections } from '@/lib/mock-data';

describe('connector mock states', () => {
  it('isolates the WhatsApp QR and exposes no provider credential', () => {
    const whatsapp = mockConnections.find((connector) => connector.id === 'whatsapp');
    if (!whatsapp) throw new Error('WhatsApp fixture missing');
    render(<ConnectionDetail connector={whatsapp} />);
    expect(screen.getByRole('img', { name: /qr code de demonstração/i })).toBeTruthy();
    expect(screen.getByText(/credenciais e instance id nunca chegam/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /simular leitura/i }));
    expect(screen.getByText('Conectando')).toBeTruthy();
  });
});
