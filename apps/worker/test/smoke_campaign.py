#!/usr/bin/env python3
"""Live campaign test: scheduled campaign -> launcher -> queue -> send -> signed receipts -> rollup. Real worker, Redis, Postgres; fake Graph."""
import hashlib, hmac, http.server, json, os, signal, subprocess, sys, threading, time, urllib.request, uuid, base64, secrets
ROOT = '/home/roger/leadbotcloud'
env = dict(os.environ)
for line in open(ROOT + '/.env'):
    line = line.strip()
    if line and not line.startswith('#') and '=' in line:
        k, v = line.split('=', 1); env.setdefault(k, v.strip().strip('"'))
env.pop('NODE_ENV', None)
APP_SECRET = 'camp-secret-' + secrets.token_hex(4); KEY = base64.b64encode(secrets.token_bytes(32)).decode(); PORT, GPORT = 4021, 4022
sent = []
class G(http.server.BaseHTTPRequestHandler):
    def do_POST(self):
        n = int(self.headers.get('content-length', 0)); body = json.loads(self.rfile.read(n) or b'{}'); sent.append((self.path, body))
        to = body.get('to', '')
        if to.endswith('0003'):   # one recipient is capped by Meta
            code, out = 400, {'error': {'message': 'x', 'code': 131049}}
        else: code, out = 200, {'messaging_product': 'whatsapp', 'messages': [{'id': 'wamid.C' + uuid.uuid4().hex[:10]}]}
        self.send_response(code); self.send_header('content-type', 'application/json'); self.end_headers(); self.wfile.write(json.dumps(out).encode())
    def log_message(self, *a): pass
gs = http.server.ThreadingHTTPServer(('127.0.0.1', GPORT), G); threading.Thread(target=gs.serve_forever, daemon=True).start()
def psql(q):
    r = subprocess.run(['docker', 'exec', 'leadbotcloud-dev-postgres-1', 'psql', '-U', 'postgres', '-d', 'leadbotcloud', '-Atc', q], capture_output=True, text=True)
    if r.returncode: raise SystemExit('psql: ' + r.stderr[:300])
    return r.stdout.strip()
enc = subprocess.run(['node', '--input-type=module', '-e', f"import {{encryptSecret}} from '{ROOT}/packages/meta/src/crypto.ts'; console.log(encryptSecret('CAMP-TOKEN','{KEY}'))"], capture_output=True, text=True, cwd=ROOT + '/apps/worker', env={**env, 'NODE_OPTIONS': '--import tsx'})
if enc.returncode: print('ENC FAIL', enc.stderr[:300]); sys.exit(1)
t = str(uuid.uuid4()); tag = t[:8]; waba = f'camp-waba-{tag}'; pn = f'camp-pn-{tag}'
psql(f"insert into tenants (id,name) values ('{t}','SMOKE camp {tag}')")
psql(f"insert into meta_accounts (tenant_id,messaging_account_id,business_token_enc,token_status,health_state) values ('{t}','{waba}','{enc.stdout.strip()}','valid','ok')")
psql(f"insert into phone_numbers (tenant_id,meta_account_id,phone_number_id,display_phone_number) select '{t}',id,'{pn}','+91 90000 00000' from meta_accounts where tenant_id='{t}'")
tpl = psql(f"insert into templates (tenant_id,name,language,category,status,body,category_current) values ('{t}','promo','en','marketing','approved','Hi {{{{1}}}}, {{{{2}}}}','marketing') returning id").splitlines()[0]
grp = psql(f"insert into contact_groups (tenant_id,name) values ('{t}','g') returning id").splitlines()[0]
people = [('Asha Verma', 'allowed', '0001'), ('Ravi Kumar', 'allowed', '0002'), ('Meena Rao', 'allowed', '0003'), ('Optout Oscar', 'stopped', '0004'), ('Unknown Una', 'unknown', '0005')]
for name, cons, suf in people:
    cid = psql(f"insert into contacts (tenant_id,phone_e164,name,consent_status) values ('{t}','+9197{int(tag[:4],16)%10000:04d}{suf}','{name}','{cons}') returning id").splitlines()[0]
    psql(f"insert into contact_group_members (tenant_id,group_id,contact_id) values ('{t}','{grp}','{cid}')")
camp = psql(f"insert into campaigns (tenant_id,name,template_id,group_ids,status,scheduled_at,var_map) values ('{t}','Smoke promo','{tpl}',ARRAY['{grp}']::uuid[],'scheduled',now()-interval '1 minute','[\"@name\",\"20% off today\"]') returning id").splitlines()[0]

wenv = {**env, 'PORT': str(PORT), 'TOKEN_ENCRYPTION_KEY': KEY, 'META_APP_SECRET': APP_SECRET, 'META_WEBHOOK_VERIFY_TOKEN': 'v', 'META_GRAPH_BASE_URL': f'http://127.0.0.1:{GPORT}', 'META_GRAPH_VERSION': 'v26.0'}
log = open('/tmp/worker-camp.log', 'w')
proc = subprocess.Popen(['pnpm', '--filter', '@lbc/worker', 'exec', 'tsx', 'src/main.ts'], cwd=ROOT, env=wenv, stdout=log, stderr=log, start_new_session=True)
results = []
def check(name, ok, extra=''): results.append(ok); print(('PASS ' if ok else 'FAIL ') + name + (f'  [{extra}]' if extra else ''))
def wait(q, pred, secs=60):
    r = ''
    for _ in range(secs):
        r = psql(q)
        if pred(r): return True, r
        time.sleep(1)
    return False, r
def sign(b): return 'sha256=' + hmac.new(APP_SECRET.encode(), b, hashlib.sha256).hexdigest()
try:
    ok, r = wait(f"select status from campaigns where id='{camp}'", lambda r: r in ('running', 'completed'), 60)
    check('launcher picked up the due campaign', ok, r)
    ok, r = wait(f"select count(*) from messages where tenant_id='{t}' and wamid is not null", lambda r: r == '2', 60)
    check('2 messages accepted by Meta (3 allowed minus 1 capped)', ok, r)
    check('Graph got /marketing_messages with product_policy', len(sent) == 3 and all(p.endswith('/marketing_messages') and b.get('product_policy') == 'CLOUD_API_FALLBACK' for p, b in sent), str([p.split('/')[-1] for p, _ in sent]))
    names = sorted(b['template']['components'][0]['parameters'][0]['text'] for _, b in sent)
    check('personalised first names sent', names == ['Asha', 'Meena', 'Ravi'], str(names))
    check('opted-out and no-permission contacts got NOTHING', all(not b['to'].endswith(('0004', '0005')) for _, b in sent))
    ok, r = wait(f"select state from campaign_recipients where campaign_id='{camp}' and name='Meena Rao'", lambda r: r == 'capped', 30)
    check('131049 recipient marked capped, not retried', ok and len(sent) == 3, r)
    # receipts
    rows = psql(f"select wamid||'|'||c.phone_e164 from messages m join conversations v on v.id=m.conversation_id join contacts c on c.id=v.contact_id where m.tenant_id='{t}' and m.wamid is not null order by c.name").splitlines()
    def hook(statuses): return json.dumps({'object': 'whatsapp_business_account', 'entry': [{'id': waba, 'changes': [{'field': 'messages', 'value': {'messaging_product': 'whatsapp', 'metadata': {'phone_number_id': pn}, 'statuses': statuses}}]}]}).encode()
    ts = str(int(time.time())); (w1, p1), (w2, p2) = [r.split('|') for r in rows]
    for wamid, ph, st in [(w1, p1, 'delivered'), (w1, p1, 'read'), (w2, p2, 'delivered')]:
        b = hook([{'id': wamid, 'status': st, 'timestamp': ts, 'recipient_id': ph[1:], 'pricing': {'category': 'marketing', 'type': 'regular', 'pricing_model': 'PMP'}}])
        req = urllib.request.Request(f'http://127.0.0.1:{PORT}/webhooks/meta', data=b, method='POST', headers={'content-type': 'application/json', 'x-hub-signature-256': sign(b)})
        urllib.request.urlopen(req, timeout=5)
    ok, r = wait(f"select counts::text from campaigns where id='{camp}'", lambda r: '"read": 1' in r and '"delivered": 2' in r and '"capped": 1' in r, 40)
    check('rollup: delivered 2, read 1, capped 1, skipped 2', ok, r)
    ok, r = wait(f"select status from campaigns where id='{camp}'", lambda r: r == 'completed', 30)
    check('campaign completes when nothing is waiting', ok, r)
    check('no duplicate messages', psql(f"select count(*) from messages where tenant_id='{t}' and direction='out'") == '3')
finally:
    try: os.killpg(proc.pid, signal.SIGTERM)
    except Exception: pass
    try: proc.wait(10)
    except Exception:
        try: os.killpg(proc.pid, signal.SIGKILL)
        except Exception: pass
    gs.shutdown()
    psql(f"delete from audit_log where tenant_id='{t}'")
    psql(f"delete from webhook_events where waba_id='{waba}' or dedupe_key like '%wamid.C%'")
    if not os.environ.get('KEEP'): psql(f"delete from tenants where id='{t}'")
print(f'\n{sum(results)}/{len(results)} passed'); sys.exit(0 if all(results) else 1)
