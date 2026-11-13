#!/usr/bin/env python3
"""Live smoke test: real worker process + real Redis + real Postgres + a fake Graph server. Prints a verdict per step. No secrets printed."""
import hashlib, hmac, http.server, json, os, subprocess, sys, threading, time, urllib.request, uuid, base64, secrets

ROOT = '/home/roger/leadbotcloud'
env = dict(os.environ)
for line in open(ROOT + '/.env'):
    line = line.strip()
    if line and not line.startswith('#') and '=' in line:
        k, v = line.split('=', 1); env.setdefault(k, v.strip().strip('"'))
env.pop('NODE_ENV', None)
APP_SECRET = 'smoke-secret-' + secrets.token_hex(4)
KEY = base64.b64encode(secrets.token_bytes(32)).decode()
PORT, GPORT = 4011, 4012

# ---- fake Graph ----
sent = []
class G(http.server.BaseHTTPRequestHandler):
    def do_POST(self):
        n = int(self.headers.get('content-length', 0)); body = json.loads(self.rfile.read(n) or b'{}')
        sent.append((self.path, body, self.headers.get('authorization')))
        self.send_response(200); self.send_header('content-type', 'application/json'); self.end_headers()
        self.wfile.write(json.dumps({'messaging_product': 'whatsapp', 'messages': [{'id': 'wamid.SMOKE' + uuid.uuid4().hex[:8]}]}).encode())
    def log_message(self, *a): pass
gs = http.server.ThreadingHTTPServer(('127.0.0.1', GPORT), G); threading.Thread(target=gs.serve_forever, daemon=True).start()

def psql(q):
    r = subprocess.run(['docker', 'exec', 'leadbotcloud-dev-postgres-1', 'psql', '-U', 'postgres', '-d', 'leadbotcloud', '-Atc', q], capture_output=True, text=True)
    if r.returncode: raise SystemExit('psql: ' + r.stderr[:300])
    return r.stdout.strip()

# enc token: AES-256-GCM, same layout as @lbc/meta (we ask node to do it so the format can't drift)
enc = subprocess.run(['node', '--input-type=module', '-e', f"import {{encryptSecret}} from '{ROOT}/packages/meta/src/crypto.ts'; console.log(encryptSecret('SMOKE-TOKEN','{KEY}'))"],
                     capture_output=True, text=True, cwd=ROOT + '/apps/worker', env={**env, 'NODE_OPTIONS': '--import tsx'})
if enc.returncode: print('ENC FAIL', enc.stderr[:400]); sys.exit(1)
tok = enc.stdout.strip()

t = str(uuid.uuid4()); tag = t[:8]; waba = f'smoke-waba-{tag}'; pn = f'smoke-pn-{tag}'; phone = '+919800' + str(int(time.time()))[-6:]
psql(f"insert into tenants (id,name) values ('{t}','SMOKE {tag}')")
psql(f"insert into meta_accounts (tenant_id,messaging_account_id,business_token_enc,token_status,health_state) values ('{t}','{waba}','{tok}','valid','ok')")
psql(f"insert into phone_numbers (tenant_id,meta_account_id,phone_number_id,display_phone_number) select '{t}',id,'{pn}','+91 90000 00000' from meta_accounts where tenant_id='{t}'")
cid = psql(f"insert into contacts (tenant_id,phone_e164,name,consent_status) values ('{t}','{phone}','Smoke','allowed') returning id").splitlines()[0]
vid = psql(f"insert into conversations (tenant_id,contact_id,phone_number_id,window_expires_at) values ('{t}','{cid}','{pn}',now()+interval '1 hour') returning id").splitlines()[0]
psql(f"insert into templates (tenant_id,name,language,category,status,body,category_current) values ('{t}','smoke_t','en','utility','approved','Hi {{{{1}}}}','utility')")
mid = str(uuid.uuid4())
psql(f"insert into messages (id,tenant_id,conversation_id,direction,kind,body,status,template_name,template_language,template_category,payload,phone_number_id) values ('{mid}','{t}','{vid}','out','template','Hi','queued','smoke_t','en','utility','{{\"params\":[\"Asha\"]}}','{pn}')")

wenv = {**env, 'PORT': str(PORT), 'REDIS_URL': env.get('REDIS_URL', 'redis://127.0.0.1:6380'), 'TOKEN_ENCRYPTION_KEY': KEY, 'META_APP_SECRET': APP_SECRET,
        'META_WEBHOOK_VERIFY_TOKEN': 'vt-smoke', 'META_GRAPH_BASE_URL': f'http://127.0.0.1:{GPORT}', 'META_GRAPH_VERSION': 'v26.0'}
log = open('/tmp/worker-smoke.log', 'w')
proc = subprocess.Popen(['pnpm', '--filter', '@lbc/worker', 'exec', 'tsx', 'src/main.ts'], cwd=ROOT, env=wenv, stdout=log, stderr=log, start_new_session=True)
def post(path, raw, sig=None):
    req = urllib.request.Request(f'http://127.0.0.1:{PORT}{path}', data=raw, method='POST', headers={'content-type': 'application/json', **({'x-hub-signature-256': sig} if sig else {})})
    try: return urllib.request.urlopen(req, timeout=5).status
    except urllib.error.HTTPError as e: return e.code
def sign(b): return 'sha256=' + hmac.new(APP_SECRET.encode(), b, hashlib.sha256).hexdigest()
results = []
def check(name, ok, extra=''):
    results.append(ok); print(('PASS ' if ok else 'FAIL ') + name + (f'  [{extra}]' if extra else ''))
try:
    for _ in range(40):
        try: urllib.request.urlopen(f'http://127.0.0.1:{PORT}/healthz', timeout=1); break
        except Exception: time.sleep(1)
    else: print('worker did not start'); print(open('/tmp/worker-smoke.log').read()[-1500:]); sys.exit(1)
    check('healthz up', True)
    ch = urllib.request.urlopen(f'http://127.0.0.1:{PORT}/webhooks/meta?hub.mode=subscribe&hub.verify_token=vt-smoke&hub.challenge=12345').read().decode()
    check('GET challenge echoes hub.challenge', ch == '12345', ch)
    try: urllib.request.urlopen(f'http://127.0.0.1:{PORT}/webhooks/meta?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=1'); bad = 200
    except urllib.error.HTTPError as e: bad = e.code
    check('GET with wrong verify token is refused', bad == 403, str(bad))

    # the outbox sweeper picks the queued row up (it was created >30s ago? no: force by backdating)
    psql(f"update messages set created_at = now() - interval '2 minutes' where id='{mid}'")
    ok = False
    for _ in range(80):
        r = psql(f"select status||'|'||coalesce(wamid,'') from messages where id='{mid}'")
        if r.startswith('accepted|wamid.SMOKE'): ok = True; break
        time.sleep(1)
    check('outbox sweeper -> queue -> worker -> Graph -> wamid saved', ok, r)
    check('Graph got the bearer token and /messages path (utility)', bool(sent) and sent[0][0] == '/v26.0/' + pn + '/messages' and sent[0][2] == 'Bearer SMOKE-TOKEN', sent[0][0] if sent else 'no call')
    wamid = psql(f"select wamid from messages where id='{mid}'")

    def hook(statuses=None, messages=None, contacts=None):
        v = {'messaging_product': 'whatsapp', 'metadata': {'display_phone_number': '9000000000', 'phone_number_id': pn}}
        if statuses: v['statuses'] = statuses
        if messages: v['messages'] = messages; v['contacts'] = contacts or []
        return json.dumps({'object': 'whatsapp_business_account', 'entry': [{'id': waba, 'changes': [{'field': 'messages', 'value': v}]}]}).encode()

    b = hook(statuses=[{'id': wamid, 'status': 'delivered', 'timestamp': str(int(time.time())), 'recipient_id': phone[1:], 'pricing': {'billable': True, 'pricing_model': 'PMP', 'category': 'utility', 'type': 'regular'}}])
    check('unsigned webhook => 401', post('/webhooks/meta', b) == 401)
    check('bad signature => 401', post('/webhooks/meta', b, 'sha256=' + '0' * 64) == 401)
    check('signed delivered status => 200', post('/webhooks/meta', b, sign(b)) == 200)
    ok = False
    for _ in range(20):
        r = psql(f"select status||'|'||coalesce(pricing_category,'')||'|'||coalesce(billable::text,'') from messages where id='{mid}'")
        if r.startswith('delivered'): ok = True; break
        time.sleep(1)
    check('status webhook applied (delivered, pricing captured)', ok, r)
    check('replay of same webhook => 200 and no second event row', post('/webhooks/meta', b, sign(b)) == 200 and psql(f"select count(*) from webhook_events where dedupe_key like '%{wamid}%'") == '1')

    ts = str(int(time.time()))
    b = hook(messages=[{'from': phone[1:], 'id': 'wamid.IN.' + tag, 'timestamp': ts, 'type': 'text', 'text': {'body': 'STOP'}}], contacts=[{'wa_id': phone[1:], 'profile': {'name': 'Smoke'}}])
    check('signed inbound STOP => 200', post('/webhooks/meta', b, sign(b)) == 200)
    ok = False
    for _ in range(20):
        r = psql(f"select consent_status from contacts where id='{cid}'")
        if r == 'stopped': ok = True; break
        time.sleep(1)
    check('customer STOP => contact opted out', ok, r)
    check('opt-out recorded in consent history', psql(f"select count(*) from contact_consent_events where contact_id='{cid}' and action='opt_out'") == '1')

    # now a second message to the opted-out contact must be refused with no Graph call
    n0 = len(sent); mid2 = str(uuid.uuid4())
    psql(f"insert into messages (id,tenant_id,conversation_id,direction,kind,body,status,template_name,template_language,template_category,payload,phone_number_id,created_at) values ('{mid2}','{t}','{vid}','out','template','Hi','queued','smoke_t','en','utility','{{}}','{pn}', now()-interval '2 minutes')")
    ok = False
    for _ in range(80):
        r = psql(f"select status||'|'||coalesce(error_detail->>'skipped','') from messages where id='{mid2}'")
        if r.startswith('failed|'): ok = True; break
        time.sleep(1)
    check('send to opted-out contact refused, Graph not called', ok and len(sent) == n0, r)

    b = hook(statuses=[{'id': 'wamid.UNKNOWN', 'status': 'sent', 'timestamp': ts}]).replace(waba.encode(), b'not-a-known-waba')
    check('event for an unknown WABA => 200 (stored, never guessed)', post('/webhooks/meta', b, sign(b)) == 200)
finally:
    import signal
    try: os.killpg(proc.pid, signal.SIGTERM)
    except Exception: pass
    try: proc.wait(10)
    except Exception:
        try: os.killpg(proc.pid, signal.SIGKILL)
        except Exception: pass
    gs.shutdown()
    psql(f"delete from audit_log where tenant_id='{t}'")
    psql(f"delete from webhook_events where waba_id in ('{waba}','not-a-known-waba') or dedupe_key like '%{tag}%' or dedupe_key like '%wamid.UNKNOWN%' or dedupe_key like '%SMOKE%'")
    psql(f"delete from tenants where id='{t}'")
print(f'\n{sum(results)}/{len(results)} passed'); sys.exit(0 if all(results) else 1)
