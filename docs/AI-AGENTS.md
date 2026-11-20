# LeadBotCloud for AI agents (Claude, Hermes, scripts)

An AI assistant can run your workspace for you: add contacts, build a segment, prepare a campaign, check how it did. You stay in control with three things: **permissions**, **money limits**, and **a switch-off button**.

## 1. Make a key
Settings → **AI assistants** → **New key**. Only the owner or an admin can. The key is shown **once**. We store only a fingerprint (SHA-256), so a lost key cannot be recovered: switch it off and make a new one.

| Permission | What it lets the assistant do |
|---|---|
| `contacts:read` | See contacts and groups |
| `contacts:write` | Add contacts and groups |
| `templates:read` | See approved templates |
| `campaigns:read` | See campaigns, their results, and preview an audience |
| `campaigns:write` | Create and cancel campaigns. **Does not send them** |
| `campaigns:send` | Start sending to customers. **Costs money** |

A new key gets everything **except** `campaigns:send`. With the default, an assistant can prepare a campaign and you press Send yourself in the panel.

## 2. Connect it
**Claude Code**
```
claude mcp add --transport http leadbotcloud https://YOUR-APP/api/mcp --header "Authorization: Bearer lbc_..."
```
**Any MCP client:** URL `https://YOUR-APP/api/mcp`, header `Authorization: Bearer lbc_...` (Streamable HTTP, stateless: every request carries the key, there are no sessions).

Then just talk to it: *“Add Priya, 98765 43210, she signed up in the shop. Put her in my Diwali group.”*

## 3. Rules the platform enforces (the assistant cannot argue its way around them)
- **Consent is never implied.** `add_contact` requires `agreedToMessages: true` and a `source`. The statement is stored with the contact and in the audit log (`consentConfirmedBy: api_key`). The assistant is told to only say yes when you told it so.
- **Opted-out customers are always skipped**, whatever the audience rules say. Promotions also skip people with no permission record.
- **Creating a campaign never sends it.** Starting needs `campaigns:send`.
- **A key can only start campaigns it created itself.** It cannot start one a person made.
- **Money limits.** Each key has a *per-send* limit (default ₹500 incl. GST). A send above it is refused. In any 24 hours it can start at most **3×** that in total, so splitting one big send into many small ones does not work. Checked under a lock, so simultaneous sends cannot slip past together.
- **A start happens once.** Asking twice does not queue it twice or count its cost twice.
- **A key is never more powerful than the person who made it.** If that person is demoted below admin or removed, the key stops working. Suspended workspaces' keys stop working.
- **Everything is logged.** Actions by a key appear in Activity as `api.…` with the key's prefix, never as a person.
- **Rate limits.** 120 calls/minute per key. 20 wrong keys/minute per address, then blocked for a minute.
- **Browser safety.** The MCP endpoint refuses requests that carry a different site's `Origin`.

## 4. Tools (MCP) and REST
Only the tools a key is allowed to use are even listed.

| MCP tool | REST | Needs |
|---|---|---|
| `whoami` | `GET /api/v1/me` | contacts:read |
| `search_contacts` | `GET /api/v1/contacts?q=&tag=&group=&limit=` | contacts:read |
| `list_groups` | `GET /api/v1/groups` | contacts:read |
| `add_contact` | `POST /api/v1/contacts` | contacts:write |
| `create_group` | `POST /api/v1/groups` | contacts:write |
| `add_contacts_to_group` | `POST /api/v1/groups/{id}/members` | contacts:write |
| `list_templates` | `GET /api/v1/templates` | templates:read |
| `preview_audience` | — | campaigns:read |
| `list_campaigns` / `get_campaign` | `GET /api/v1/campaigns`, `/{id}` | campaigns:read |
| `campaign_report` | `GET /api/v1/campaigns/{id}/report` | campaigns:read |
| `create_campaign` | `POST /api/v1/campaigns` | campaigns:write |
| `cancel_campaign` | `POST /api/v1/campaigns/{id}/cancel` | campaigns:write |
| `start_campaign` | `POST /api/v1/campaigns/{id}/send` | campaigns:send |
| `send_winner` | `POST /api/v1/campaigns/{id}/winner` | campaigns:send |

Errors are `{"error": "plain words"}` with a normal HTTP status (401 key, 403 permission, 422 rejected input, 429 slow down).

## A/B tests and sending the winner
`create_campaign` (and `POST /api/v1/campaigns`) also accepts a second template to test against the first:
- `abTemplateId`, `abVarMap`: the second template and its blanks. It must be approved, of the same kind (same category, same offer and website button type) and a different template.
- **Even split, everyone messaged now:** add `abPercentB` (10 to 90), the share who get version B.
- **Test first, send the winner later:** add `abHoldRest: true` and `abTestPct` (10 to 50). Only that share of people is messaged at first, half on each version. Everyone else is kept back and gets nothing until the winner is chosen. Needs at least 4 people.

The flow for an assistant: create the campaign, `preview_audience`, show the user the cost, start it with `start_campaign` (the cost counts the WHOLE audience, held-back people included, against the key's per-send and 24-hour limits), wait until the test messages have gone out, read `campaign_report` (its `abTest.hold` section says how many are waiting, whether the test is done, and a suggested version only when the evidence is clear), show the user both versions' results, and let THE USER choose. Then `send_winner` with `version` "a" or "b".

`send_winner` rules, all enforced on the server and not just by the assistant's manners:
- needs `campaigns:send`; a key without it is never even shown the tool;
- only for a campaign this same key created AND started, so the cost is already inside the key's limits. Sending the winner adds no spend of its own, and the key's 24-hour total does not change;
- works once; a second or simultaneous call changes nothing more;
- refused while test messages are still going out, when no test message went out, or for a campaign that was not set up to hold people back;
- at the moment of sending, the worker checks everyone again: people who opted out since, numbers that turned out unreachable, an ended offer, a missing connection, a failing payment method and the campaign's spend cap are all handled, and a refusal sends nothing and says why in the report (`abTest.hold.error`).

## 5. Known limits
- Rate limits are shared through Redis when `REDIS_URL` is set (counted per address and per key); without it each web process counts alone.
- No way yet to import many contacts in one call (use the panel's CSV import) or to edit/delete a contact.
- No saved-segment tools for agents yet; segments are built in the panel.
- `start_campaign` takes a `userConfirmed` flag. It is a prompt to the assistant to ask you first, not a security control: the real protections are the permission, the creator rule and the money limits.
- The API is not yet versioned beyond `/v1` and has no webhook-out events.


## Tracked links

A template can have a **Tracked link** website button (made in the template builder). When you create a campaign with such a template, pass `linkUrl`
(an https address of your own; no shorteners, no local addresses). Every person then gets their own private link, so the report shows how many
different people clicked. Link-preview robots and security scanners are not counted. Follow-ups such as "clicked the link" or "did not click" are
saved as groups from the report page. A tracked link needs a permanent `APP_URL`: sending is paused with a clear reason if the app address is a temporary tunnel.
