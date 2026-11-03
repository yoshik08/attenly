import type { MetadataRoute } from 'next';
import { BASE_PATH } from '@/lib/api';

/** Lets students add Attenly to their home screen as a standalone app. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Attenly',
    short_name: 'Attenly',
    description: 'KL University attendance, synced for you, with how many classes you can still skip.',
    start_url: BASE_PATH,
    scope: `${BASE_PATH}/`,
    display: 'standalone',
    background_color: '#000000',
    theme_color: '#000000',
    icons: [
      { src: `${BASE_PATH}/icon-192.png`, sizes: '192x192', type: 'image/png' },
      { src: `${BASE_PATH}/icon-512.png`, sizes: '512x512', type: 'image/png' },
      { src: `${BASE_PATH}/icon-maskable-512.png`, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
