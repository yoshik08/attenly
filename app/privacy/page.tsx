import Link from 'next/link';

export const metadata = {
  title: 'Privacy — Attenly',
};

export default function PrivacyPage() {
  return (
    <article className="page-in mx-auto max-w-[640px] py-8 lg:py-12">
      <h1 className="title-l">Privacy</h1>
      <p className="mt-3 text-[16px] text-dropout-text pretty">
        Attenly is a student-built front for the KL University ERP. This is what it keeps, and why.
      </p>

      <h2 className="title-s mt-10">What Attenly stores</h2>
      <ul className="mt-3 flex list-disc flex-col gap-2 pl-5 text-[15px] text-mark marker:text-dropout">
        <li>Your Google name and email, to know whose data is whose.</li>
        <li>
          Your KL University ID and ERP password, so Attenly can sign into the ERP and sync for you. They are stored as
          you typed them, not encrypted, in Attenly’s MongoDB database.
        </li>
        <li>What each sync pulls from the ERP: attendance counts, timetable, internal marks, results and grades.</li>
        <li>In your browser: a copy of the last sync, your settings and saved calculator results.</li>
      </ul>

      <h2 className="title-s mt-10">What Attenly never does</h2>
      <ul className="mt-3 flex list-disc flex-col gap-2 pl-5 text-[15px] text-mark marker:text-dropout">
        <li>It never shows your password back to you or sends it anywhere except the KL ERP login.</li>
        <li>It never shares, sells or rents your data, and never uses it for advertising.</li>
        <li>It only shows your data to your own Google account.</li>
      </ul>

      <h2 className="title-s mt-10">Removing your data</h2>
      <p className="mt-3 text-[15px] text-mark pretty">
        <Link href="/settings#accounts" className="underline">
          Settings → ERP accounts → Remove
        </Link>{' '}
        deletes that account’s saved password and every synced snapshot of it. “Forget data on this device” clears the
        browser copy.
      </p>

      <p className="mt-12 text-[12px] text-dropout-quiet">Unofficial, not affiliated with KL University. Updated November 2026.</p>
    </article>
  );
}
