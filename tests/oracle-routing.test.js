// Opt-in integration test: writes one synthetic PARA resource, verifies replay,
// and removes that exact resource in finally. Credentials stay on Oracle.
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {Modulo, routeReceipt} from '../modulo.js';
const remote = `import sys,json,os
os.environ.update(MODULO_BASE_URL='https://modulo.141.147.5.114.sslip.io',MODULO_API_TOKEN_FILE='/home/ubuntu/.config/modulo-mcp/access-token',MODULO_OIDC_REFRESH_TOKEN_FILE='/home/ubuntu/.config/modulo-mcp/refresh-token')
sys.path.insert(0,'/srv/modulo/tools/modulo_mcp')
from client import ModuloClient
request=json.load(sys.stdin)
try:
 result=ModuloClient()._request(request['path'],request['method'],request.get('body'))
 print(json.dumps({'ok':True,'result':result}))
except Exception as error: print(json.dumps({'ok':False,'error':str(error)}))`;
function sshRequest(value) {
  return new Promise((resolve, reject) => {
    const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
    const child = spawn('ssh', ['-T', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', 'oracle', `/srv/modulo/tools/modulo_mcp/.venv/bin/python -c ${quote(remote)}`]);
    let output = '', errors = '';
    child.stdout.on('data', value => {output += value;}); child.stderr.on('data', value => {errors += value;});
    child.on('error', reject); child.on('exit', code => {
      if (code) {reject(new Error(`SSH failed: ${errors}`)); return;}
      try { const response = JSON.parse(output); if (!response.ok) reject(new Error(response.error)); else resolve(response.result); } catch (error) {reject(error);}
    });
    child.stdin.end(JSON.stringify(value));
  });
}

test('Oracle Modulo accepts a routed resource and idempotent replay', {skip: process.env.MODULO_ORACLE_TEST !== '1', timeout: 45000}, async () => {
  const settings = {moduloURL: 'https://modulo.141.147.5.114.sslip.io', moduloToken: 'remote-custody-only'};
  const client = new Modulo(settings, async (url, options) => {
    const result = await sshRequest({path: new URL(url).pathname, method: options.method, body: options.body ? JSON.parse(options.body) : undefined});
    return new Response(JSON.stringify(result));
  });
  const record = await client.para();
  const pending = {key: `test-${crypto.randomUUID()}`, moduloURL: settings.moduloURL,
    capture: {question: 'Synthetic routing verification — automatically removed',
      context: {kind: 'project', id: 'proj-browse-implement-browser-noesis-capture', version: record.version}, sources: [{title: 'Temporary BROWSE-CAPTURE routing test'}]}};
  const receipt = {session_id: `intake:test:${pending.key}`, namespace: 'capture-tests', revision: 2, action: 'save', execution: 'source_capture'};
  const id = `noesis-capture-${pending.key}`;
  try {
    const result = await routeReceipt(settings, pending, receipt, client);
    assert.equal(result.resourceId, id);
    const replay = await routeReceipt(settings, pending, receipt, client);
    assert.equal(replay.replayed, true);
    const current = await client.para();
    assert.equal(current.value.resources.filter(item => item.id === id).length, 1);
    assert.equal(current.value.resources.find(item => item.id === id).projectIds[0], pending.capture.context.id);
  } finally {
    const current = await client.para();
    if (current.value.resources.some(item => item.id === id)) {
      await client.request('/api/workspaces/personal/plugin-state/workspace-para/data', 'PUT', {
        expectedVersion: current.version, schemaId: current.schemaId, schemaVersion: current.schemaVersion,
        value: {...current.value, resources: current.value.resources.filter(item => item.id !== id)}
      });
    }
  }
});
