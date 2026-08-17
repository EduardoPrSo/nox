import { fireEvent, render, screen } from '@testing-library/react';
import { ChatWorkspace } from './chat-workspace';

describe('confirmation experience', () => {
  it('never approves an external action without an explicit click', () => {
    render(<ChatWorkspace />);
    expect(screen.getByText('Confirmação necessária')).toBeTruthy();
    expect(screen.queryByText('Confirmado')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /confirmar/i }));
    expect(screen.getByText('Confirmado')).toBeTruthy();
  });
});
