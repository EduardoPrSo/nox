import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'NOX · Personal Intelligence',
    short_name: 'NOX',
    description: 'Seu agente pessoal, presente onde você estiver.',
    start_url: '/',
    display: 'standalone',
    background_color: '#08090d',
    theme_color: '#08090d',
    categories: ['productivity', 'utilities'],
    icons: [
      { src: '/icons/nox-orb.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
      {
        src: '/icons/nox-orb-maskable.svg',
        sizes: 'any',
        type: 'image/svg+xml',
        purpose: 'maskable',
      },
    ],
  };
}
