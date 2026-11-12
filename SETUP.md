# Restaurant Training

The app is connected to the Supabase **Training App** project. FOH and BOH training pages are open to view, with no signup or password screen. Team records and progress require an authorized leader sign-in.

## Owner access

The owner email has been approved privately in the database and its Auth identity has been verified. Select **Owner sign-in**, enter your approved email, and request a one-time sign-in email. Paste the email code or copy the original link from the email without opening it. If you already clicked the link and Safari could not open the page, copy the address from the Safari error tab and paste it into **I already have a link or code** in the app. The app checks the returned session with Supabase and does not request another email. Paste this address only in the app. If the address no longer contains an active sign-in, wait for any sending limit to reset and request a fresh email.

For clicking an email link to return directly to the app, open the Training App project's Authentication → URL Configuration at https://supabase.com/dashboard/project/gclawgkpfgfgsavckwzx/auth/url-configuration. Set **Site URL** to the exact published app address, including its trailing slash, and add the same address under **Redirect URLs**. The app requests this return address and handles the verified session automatically. The previous default `http://localhost:3000` caused successful email verification to return to a nonexistent local app. Changing the redirect does not revive a used link; request a new one afterward.

Email-link sign-in creates the underlying Supabase Auth identity on the first verified use. The database grants a role only to approved, confirmed email addresses. The app checks identity with Supabase Auth and loads the role from the database before showing owner tools. Visitors can browse checklists immediately; public viewers cannot edit records or access team progress. Keep Supabase's email confirmation enabled.

Additional leaders can be approved by adding their email to the private invitations table with role `trainer`. Owners can edit training content and settings. Owners and trainers can manage team records and record progress. Training members without logins can be tracked by their trainers. Optional member logins use role `member` and require their team record's `auth_user_id` to be linked to their own user ID by an administrator.

## App behavior

- Switch between BOH and FOH in the header. Categories and overall training statuses are separate for each department; team records are shared.
- Edit Training lets an owner choose a category, edit its page title, rename section headings, add items, and paste actual Pathway links.
- BOH items open a full page for Title, Instructions, and the optional link. Save Changes returns to the checklist; Cancel discards the draft.
- BOH → Primary → Make includes the Regular CFA Sandwich and Spicy CFA Sandwich checklist items. The regular sandwich has an illustrated build with replay and an enlarged view. Viewing the build does not mark a trainee as trained.
- Delete on an item hides it while preserving progress. Restore is available in Edit Training. Deleting a category or team member permanently removes dependent records after confirmation.
- Trainer View lets a leader select a team member and record checklist items as Not started, In Training, or Trained.
- All Progress has a leader-set overall status, separate from the percentage of checklist items marked Trained.
- BOH Closing opens Closing Boards, Closing Machines, Closing Breading Table, and Closing Dishes.
- Pathway links open in a new tab, may need Pathway sign-in, and do not automatically record completion.
- Download a JSON data backup from Settings before major changes. Import is not implemented; exports support keeping records and manual recovery. Git history and the source ZIP keep copies of code.

Visible examples in the recordings are starter content. Add your complete, approved restaurant training and real Pathway URLs; no Pathway URLs were invented.

## Hosting and source

Live app: use the production URL assigned by your hosting service.

GitHub draft source: https://github.com/sarahvang-code/cfa-training2.0/tree/restaurant-training-draft

To publish on a static host, use the files at the root of the draft branch. The app needs no build step. Add the exact production URL to the Supabase redirect settings above before sharing it with leaders.

For a fresh Supabase project, run `supabase-schema.sql`, then `supabase-account-access.sql`, then `supabase-public-view.sql`, once each. Do not rerun them against the configured Training App project. Use only a publishable API key in `config.js`; never a secret or service-role key. Invited emails and access grants are private database data, not public source configuration.

## Verification and home screen

Local progress, persistence, hide/restore, and mocked API tests pass. Auth regression tests cover email return addresses, callback handling, server identity validation, session restoration and refresh, expired links, email mismatch, role approval, and logout. All exposed app tables have Row Level Security. The private invitation table intentionally has no client policies or grants. Database checks confirm public training access and private team data restrictions. Supabase logs confirmed successful owner email verification and exposed the incorrect localhost return address. A live clicked-link test requires the URL configuration above; browser and two-device tests remain to be completed.

On two devices, sign in to the same project as authorized leaders. Add a member, edit a checklist item, and record Trained on device A. Reload device B or wait up to 15 seconds with the app visible; confirm the changes appear. Verify that a member can see only their own record and cannot edit training.

On iPhone/iPad, use Safari → Share → Add to Home Screen. On Android, use Chrome's menu → Install app/Add to Home screen. The service worker caches the static shell; cloud login and changes require internet. Cloud records are not cached or queued offline. Verified sessions are stored on the device, checked with Supabase Auth on reopening, and refreshed as needed. Sign out on shared devices to remove the stored session and private team data from memory.

## Supabase references

- https://supabase.com/docs/guides/getting-started/api-keys
- https://supabase.com/docs/guides/database/postgres/row-level-security
- https://supabase.com/docs/guides/auth/auth-email-passwordless
- https://supabase.com/docs/guides/auth/redirect-urls
