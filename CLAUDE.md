# Operation Head Shave

Read **[SPEC.md](SPEC.md)** first. It is the complete project brief and the source of
truth for behaviour, copy, styling, and prohibitions.

## Non-negotiables (full list in SPEC.md §13)

- Never email the barber without a human click while `BARBER_MODE=draft`.
- Never send any barber email while the template contains the string `PLACEHOLDER`.
- Never scrape Instagram HTML or use session cookies. Official Graph API only.
- Never store Andrea's or the barber's contact details in this repo. Env vars only.
- Never transition to FAILURE on an API error, timeout, or empty response.
- Never trust the client clock or client-reported status. The server owns `deadlineAt`.
- Never commit uploaded photos.

## Layout

```
src/lib/state.ts        pure state machine — no I/O, fully unit tested
src/lib/store.ts        KV adapter (Upstash, in-memory fallback for dev/test)
src/lib/sources/        PostSource implementations (mock, instagram)
src/lib/notify/         Notifier implementations (email, telegram stub)
src/lib/check.ts        the orchestrator: fetch -> evaluate -> persist -> effects
src/app/(public)/       shave.jacobkao.com
src/app/p/[token]/      protocol.jacobkao.com
src/app/admin/          overrides, simulate, templates
```

## Rules of the road

- `src/lib/state.ts` must stay pure. It returns `{ state, effects }`; the caller performs
  the effects. Every new behaviour gets a test in `src/lib/state.test.ts`.
- Run `npm test` and `npm run build` before declaring a phase done.
