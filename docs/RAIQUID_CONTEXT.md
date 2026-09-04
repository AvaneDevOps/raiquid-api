# Raiquid API — context notes

Cross-cutting notes that don't belong in code comments or the README: things
learned from the frontend that affect future backend work.

## Open decisions

- **Investor funding minimum.** The frontend's investor screens enforce a
  hard minimum of ₦5,000 per investment. Nothing in this API enforces it yet.
  When the Investor module (`POST /investor/marketplace/:id/fund`) is
  implemented for real, add `@Min(5000)` to `FundInvoiceDto.amount`.

- **Investor fee model is unmodeled.** Investors are charged a fee taken out
  of their *return* on a funded invoice — a different concept from
  `Invoice.platformFeePct` / `Invoice.reserveContributionPct`, which are
  business-side fees charged against the invoice itself. Nothing in the
  schema currently represents an investor-side fee. This needs a schema
  decision (a field on `Holding`? a platform-wide config value?) before
  Investor funding logic is implemented — flagging so it isn't silently
  missed, not deciding it here.
