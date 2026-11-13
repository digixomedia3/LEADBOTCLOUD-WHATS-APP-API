#!/usr/bin/env python3
"""Live template test: owner submits -> worker sends to fake Meta -> pending -> signed approval webhook -> approved -> 6h sync adopts a manager-made format -> delete removes at Meta."""
import hashlib, hmac, http.server, json, os, signal, subprocess, sys, threading, time, urllib.request, uuid, base64, secrets
ROOT = '/home/roger/leadbotcloud'
env = dict(os.environ)
for line in open(ROOT + '/.env'):
    line = line.strip()
    if line and not line.startswith('#') and '=' in line:
        k, v = line.split('=', 1); env.setdefault(k, v.strip().strip('"'))
env.pop('NODE_ENV', None)
APP_SECRET = 'tpl-secret-' + secrets.token_hex(4); KEY = base64.b64encode(secrets.token_bytes(32)).decode(); PORT, GPORT = 4051, 4052
store = {}; log = []
class G(http.server.BaseHTTPRequestHandler):
    def _s(self, c, o): self.send_response(c); self.send_header('content-type', 'application/json'); self.end_headers(); self.wfile.write(json.dumps(o).encode())
    def do_POST(self):
        n = int(self.headers.get('content-length', 0)); b = json.loads(self.rfile.read(n) or b'{}'); log.append(('POST', self.path.split('?')[0], b))
        if self.path.split('?')[0].endswith('/message_templates'):
            t = {'id': str(7000 + len(store)), 'name': b['name'], 'language': b['language'], 'status': 'PENDING', 'category': b['category'], 'components': b['components']}
            store[b['name']] = t; return self._s(200, {'id': t['id'], 'status': 'PENDING', 'category': t['category']})
        self._s(404, {'error': {'message': 'no', 'code': 100}})
    def do_GET(self):
        log.append(('GET', self.path.split('?')[0], None))
        if self.path.split('?')[0].endswith('/message_templates'): return self._s(200, {'data': list(store.values()), 'paging': {'cursors': {}}})
        self._s(404, {'error': {'message': 'no', 'code': 100}})
    def do_DELETE(self):
        name = self.path.split('name=')[1].split('&')[0]; log.append(('DELETE', name, None)); store.pop(name, None); self._s(200, {'success': True})
    def log_message(self, *a): pass
gs = http.server.ThreadingHTTPServer(('127.0.0.1', GPORT), G); threading.Thread(target=gs.serve_forever, daemon=True).start()
def psql(q):
    r = subprocess.run(['docker', 'exec', 'leadbotcloud-dev-postgres-1', 'psql', '-U', 'postgres', '-d', 'leadbotcloud', '-Atc', q], capture_output=True, text=True)
    if r.returncode: raise SystemExit('psql: ' + r.stderr[:300])
    return r.stdout.strip()
enc = subprocess.run(['node', '--input-type=module', '-e', f"import {{encryptSecret}} from '{ROOT}/packages/meta/src/crypto.ts'; console.log(encryptSecret('TPL-TOKEN','{KEY}'))"], capture_output=True, text=True, cwd=ROOT + '/apps/worker', env={**env, 'NODE_OPTIONS': '--import tsx'})
if enc.returncode: print('ENC FAIL', enc.stderr[:300]); sys.exit(1)
t = str(uuid.uuid4()); tag = t[:8]; waba = f'tpl-waba-{tag}'
psql(f"insert into tenants (id,name) values ('{t}','SMOKE tpl {tag}')")
psql(f"insert into meta_accounts (tenant_id,messaging_account_id,business_token_enc,token_status,health_state) values ('{t}','{waba}','{enc.stdout.strip()}','valid','ok')")
mine = psql(f"insert into templates (tenant_id,name,language,category,status,body,samples,submit_requested_at) values ('{t}','diwali_{tag}','en','marketing','pending','Hi {{{{1}}}}, our Diwali offer: {{{{2}}}}','[\"Asha\",\"20% off\"]',now()) returning id").splitlines()[0]
wenv = {**env, 'PORT': str(PORT), 'TOKEN_ENCRYPTION_KEY': KEY, 'META_APP_SECRET': APP_SECRET, 'META_WEBHOOK_VERIFY_TOKEN': 'v', 'META_GRAPH_BASE_URL': f'http://127.0.0.1:{GPORT}', 'META_GRAPH_VERSION': 'v26.0'}
proc = subprocess.Popen(['pnpm', '--filter', '@lbc/worker', 'exec', 'tsx', 'src/main.ts'], cwd=ROOT, env=wenv, stdout=open('/tmp/worker-tpl.log', 'w'), stderr=subprocess.STDOUT, start_new_session=True)
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
def post_hook(value):
    b = json.dumps({'object': 'whatsapp_business_account', 'entry': [{'id': waba, 'changes': [{'field': 'message_template_status_update', 'value': value}]}]}).encode()
    req = urllib.request.Request(f'http://127.0.0.1:{PORT}/webhooks/meta', data=b, method='POST', headers={'content-type': 'application/json', 'x-hub-signature-256': sign(b)})
    return urllib.request.urlopen(req, timeout=5).status
try:
    ok, r = wait(f"select coalesce(meta_template_id,'') from templates where id='{mine}'", lambda r: r != '', 60)
    check('worker sent the pending format to Meta and saved its id', ok, r)
    created = [b for m, p, b in log if m == 'POST' and p.endswith('/message_templates')]
    check('payload: MARKETING, positional, body example', len(created) == 1 and created[0]['category'] == 'MARKETING' and created[0]['components'][0]['example'] == {'body_text': [['Asha', '20% off']]}, str(created[0]['category']) if created else 'none')
    check('format stays pending until Meta decides', psql(f"select status from templates where id='{mine}'") == 'pending')
    time.sleep(22)
    check('it is not submitted twice', len([1 for m, p, b in log if m == 'POST']) == 1)

    check('signed APPROVED webhook accepted', post_hook({'event': 'APPROVED', 'message_template_id': 7000, 'message_template_name': f'diwali_{tag}', 'message_template_language': 'en'}) == 200)
    ok, r = wait(f"select status from templates where id='{mine}'", lambda r: r == 'approved', 30)
    check('webhook moved it to approved', ok, r)

    # a format someone built in WhatsApp Manager appears at the next sync; force the sync to be due
    store['manager_made'] = {'id': '8100', 'name': 'manager_made', 'language': 'en', 'status': 'APPROVED', 'category': 'UTILITY', 'components': [{'type': 'BODY', 'text': 'Your order {{1}} has shipped', 'example': {'body_text': [['#123']]}}], 'quality_score': {'score': 'GREEN'}}
    store['with_image'] = {'id': '8101', 'name': 'with_image', 'language': 'en', 'status': 'APPROVED', 'category': 'MARKETING', 'components': [{'type': 'HEADER', 'format': 'IMAGE'}, {'type': 'BODY', 'text': 'hi'}]}
    psql(f"update meta_accounts set templates_synced_at = now() - interval '7 hours' where tenant_id='{t}'")
    ok, r = wait(f"select count(*) from templates where tenant_id='{t}' and name='manager_made'", lambda r: r == '1', 60)
    check('6-hour sync imported the format made in WhatsApp Manager', ok, r)
    check('sync did NOT import the image-header format it cannot represent', psql(f"select count(*) from templates where tenant_id='{t}' and name='with_image'") == '0')
    check('sync recorded its time', psql(f"select (templates_synced_at > now() - interval '1 minute')::text from meta_accounts where tenant_id='{t}'") == 'true')

    psql(f"update templates set status='deleting' where id='{mine}'")
    ok, r = wait(f"select count(*) from templates where id='{mine}'", lambda r: r == '0', 60)
    check('delete: removed at Meta, then the row', ok and f'diwali_{tag}' not in store, r)

    check('a signed REJECTED webhook for an unknown format is accepted and ignored', post_hook({'event': 'REJECTED', 'message_template_name': 'nope', 'message_template_language': 'en', 'reason': 'INVALID_FORMAT'}) == 200)
finally:
    try: os.killpg(proc.pid, signal.SIGTERM)
    except Exception: pass
    try: proc.wait(10)
    except Exception:
        try: os.killpg(proc.pid, signal.SIGKILL)
        except Exception: pass
    gs.shutdown()
    psql(f"delete from audit_log where tenant_id='{t}'")
    psql(f"delete from webhook_events where waba_id='{waba}'")
    psql(f"delete from tenants where id='{t}'")
print(f'\n{sum(results)}/{len(results)} passed'); sys.exit(0 if all(results) else 1)
