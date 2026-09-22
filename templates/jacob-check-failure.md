Subject: OPERATION HEAD SHAVE — the checker is blind

{{reason}}

The system has NOT transitioned and will not transition while checks are
inconclusive — it fails safe. But it is also not watching anything right now.

  LAST GOOD CHECK ... {{last_check_local}}
  LAST POST ......... {{last_post_date}}

Likely causes, in order (SPEC.md §12):
  1. The long-lived token expired. Expired tokens cannot be refreshed — re-run
     the OAuth flow at {{public_url}}/api/auth/instagram/start
  2. The Instagram account reverted to a personal account.
  3. The app's tester role was removed in Instagram → Settings → Apps and Websites.

Admin: {{admin_url}}
