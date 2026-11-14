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

Errors are `{"error": "plain words"}` with a normal HTTP status (401 key, 403 permission, 422 rejected input, 429 slow down).

## 5. Known limits
- Rate limits are in memory per web process. Several web servers need a shared store (Redis) before launch.
- No way yet to import many contacts in one call (use the panel's CSV import) or to edit/delete a contact.
- No saved-segment tools for agents yet; segments are built in the panel.
- `start_campaign` takes a `userConfirmed` flag. It is a prompt to the assistant to ask you first, not a security control: the real protections are the permission, the creator rule and the money limits.
- The API is not yet versioned beyond `/v1` and has no webhook-out events.
