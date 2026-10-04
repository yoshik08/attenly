import { Container, GlassPanel, SectionHeader } from '@/components/ui';

export const metadata = {
  title: 'Privacy — Attenly',
};

export default function PrivacyPage() {
  return (
    <Container className="max-w-2xl py-12">
      <SectionHeader
        kicker="Legal"
        title="Privacy policy"
        sub="What Attenly collects, and what it never does."
      />
      <GlassPanel className="prose-sm p-6 sm:p-8">
        <div className="flex flex-col gap-5 text-sm leading-relaxed text-slate-300">
          <p>
            Attenly is a student-built front for the KL University ERP. It exists to show you
            your attendance and timetable in a cleaner interface than the official portal.
          </p>
          <div>
            <p className="font-bold text-white">What we collect</p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-slate-400">
              <li>Your Google profile (name and email) when you sign in with Google.</li>
              <li>
                Your ERP university ID and an <em>encrypted</em> copy of your ERP password, so
                you can re-link with one tap. The password is sealed with AES-256-GCM and can
                only be decrypted by this application's server.
              </li>
              <li>
                Snapshots of your attendance and timetable, pulled from the KL ERP at your
                request.
              </li>
            </ul>
          </div>
          <div>
            <p className="font-bold text-white">What we never do</p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-slate-400">
              <li>We never store your ERP password in readable form.</li>
              <li>We never sell, rent, or share your data with anyone.</li>
              <li>We never use your data for advertising.</li>
            </ul>
          </div>
          <p className="text-slate-400">
            Your data lives in a private MongoDB database and is only used to operate Attenly
            for you. Signing out of Google does not delete your snapshots — contact the
            developer if you want everything wiped.
          </p>
          <p className="text-xs text-slate-500">Last updated: October 2026.</p>
        </div>
      </GlassPanel>
    </Container>
  );
}
