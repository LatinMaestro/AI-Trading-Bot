# Client actions

No action is required for research, documentation, tests or paper-trading development.

Future client-only gates, in order:

1. Review and accept the risk and tax implications.
2. Create and verify the selected exchange account.
3. Confirm the account's current API permission controls.
4. Create a key with only the approved query and spot-order permissions and with every withdrawal/funding permission disabled.
5. Enter the key directly into Cloudflare secrets; never provide it in chat or GitHub.
6. Approve shadow mode.
7. Approve a specific canary amount after the evidence gates pass.
8. Deposit the approved amount using a network and address shown in the exchange interface.
9. Approve later capital increases individually.
10. Withdraw through the exchange interface when desired; the bot never performs withdrawals.

The existing ETH on Polygon must not be sent until the chosen exchange confirms the exact supported asset and network in the user's own account. Sending to an unsupported network can permanently lose funds.
