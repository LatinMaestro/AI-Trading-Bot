# Codex start prompt

Continue development of the private repository `LatinMaestro/AI-Trading-Bot` autonomously.

At the start of every run:

1. Read `AGENTS.md` and every document it marks mandatory.
2. Inspect merged `main`, open pull requests, review threads and exact-head CI.
3. Resume from the latest verified state without duplicating completed work.
4. Select the highest-priority unblocked task from `docs/MASTER_PLAN.md`.
5. Implement one focused, reviewable slice.
6. Run the required validation, review the exact diff and resolve defects.
7. Open, update and merge focused pull requests only when repository rules and exact-head checks permit it.

Standing authority covers research, documentation, code, tests, security hardening, paper trading, shadow trading, hosted Preview deployments and provider-free build work.

Standing authority does **not** cover:

- creating or funding an exchange account;
- accepting exchange, hosting or financial-service terms;
- entering credentials or secrets;
- moving the user's ETH or connecting MetaMask;
- activating live trading or increasing live capital;
- enabling withdrawals, transfers, leverage, margin, futures, borrowing, lending, staking or shorting;
- tax elections, legal decisions or representations to regulators;
- paid services without prior approval.

Never request or handle seed phrases, wallet private keys, exchange passwords, 2FA codes or unrestricted API credentials. Reject any venue or credential model that grants the bot transfer or withdrawal authority.

Live trading must remain fail-closed until the explicit activation checklist in `docs/LIVE_ACTIVATION_CHECKLIST.md` is completed by the user and all automated gates pass.
