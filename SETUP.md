# Restaurant Training

The app is connected to the Supabase **Training App** project. FOH and BOH training pages are open to view, with no signup or password screen. Team records and progress require an authorized leader sign-in.

## Owner access

The owner email has been approved privately in the database. Select **Owner sign-in**, enter your approved email, and request a one-time sign-in link. Copy the link from the Supabase email and paste it into the verification form without opening it first. If your email template includes a code, you can enter the code instead. This verifies your email and activates your full owner role without asking you to set a password or fill out a registration form.

Email-link sign-in creates the underlying Supabase Auth identity on the first verified use. The database grants a role only to approved, confirmed email addresses. Visitors can browse checklists immediately; public viewers cannot edit records or access team progress. Keep Supabase's email confirmation enabled.

Additional leaders can be approved by adding their email to the private invitations table with role `trainer`. Owners can edit training content and settings. Owners and trainers can manage team records and record progress. Training members without logins can be tracked by their trainers. Optional member logins use role `member` and require their team record's `auth_user_id` to be linked to their own user ID by an administrator.

## App behavior

- Switch between BOH and FOH in the header. Categories and overall training statuses are separate for each department; team records are shared.
- Edit Training lets an owner choose a category, edit its page title, rename section headings, add items, and paste actual Pathway links.
- Delete on an item hides it while preserving progress. Restore is available in Edit Training. Deleting a category or team member permanently removes dependent records after confirmation.
- Trainer View lets a leader select a team member and record checklist items as Not started, In Training, or Trained.
- All Progress has a leader-set overall status, separate from the percentage of checklist items marked Trained.
- BOH Closing opens Closing Boards, Closing Machines, Closing Breading Table, and Closing Dishes.
- Pathway links open in a new tab, may need Pathway sign-in, and do not automatically record completion.
- Download a JSON data backup from Settings before major changes. Import is not implemented; exports support keeping records and manual recovery. Git history and the source ZIP keep copies of code.

Visible examples in the recordings are starter content. Add your complete, approved restaurant training and real Pathway URLs; no Pathway URLs were invented.

## Hosting and source

Live app: https://restaurant-training.fondmoss.chatgpt.site

GitHub source: https://github.com/sarahvang-code/cfa-training2.0

For GitHub Pages, use repository Settings → Pages → Deploy from a branch → main → / (root). The static app uses relative paths and can work under the repository path. GitHub stores and serves code; training data is read and written directly through Supabase with the signed-in user's permissions.

For a fresh Supabase project, run `supabase-schema.sql`, then `supabase-account-access.sql`, then `supabase-public-view.sql`, once each. Do not rerun them against the configured Training App project. Use only a publishable API key in `config.js`; never a secret or service-role key. Invited emails and access grants are private database data, not public source configuration.

## Verification and home screen

Local progress, persistence, hide/restore, and mocked API tests pass. Database checks confirm accounts without training access cannot see training or team rows. All exposed app tables have Row Level Security. The private invitation table intentionally has no client policies or grants. Anonymous read access has been checked against the database. The owner email-link sign-in and two-device synchronization complete after the owner verifies their email.

On two devices, sign in to the same project as authorized leaders. Add a member, edit a checklist item, and record Trained on device A. Reload device B or wait up to 15 seconds with the app visible; confirm the changes appear. Verify that a member can see only their own record and cannot edit training.

On iPhone/iPad, use Safari → Share → Add to Home Screen. On Android, use Chrome's menu → Install app/Add to Home screen. The service worker caches the static shell; cloud login and changes require internet. Cloud records are not cached or queued offline. Sessions stay in memory; sign in again after reloading.

## Supabase references

- https://supabase.com/docs/guides/getting-started/api-keys
- https://supabase.com/docs/guides/database/postgres/row-level-security
- https://supabase.com/docs/guides/auth/passwords
