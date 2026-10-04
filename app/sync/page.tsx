import { redirect } from 'next/navigation';

/** The link flow now lives on the home page gate. */
export default function SyncRedirect() {
  redirect('/');
}
