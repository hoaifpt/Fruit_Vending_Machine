import test from 'node:test'
import assert from 'node:assert/strict'
import { fresh, transition as step, restore } from '../src/features/purchase/machine.ts'
import { resolvePage } from '../src/routing.ts'
const start=()=>step(fresh(),{type:'select',slot:'1',id:'DEMO-TEST',now:1000})
const ready=()=>step(start(),{type:'ready'},1500)
test('purchase route is isolated from admin and supports trailing slash',()=>{assert.equal(resolvePage('/buy'),'purchase');assert.equal(resolvePage('/buy/'),'purchase');assert.equal(resolvePage('/buy/unknown'),'not-found')})
test('selection blocks nonexistent and sold-out slots',()=>{assert.throws(()=>step(fresh(),{type:'select',slot:'99',id:'DEMO-TEST',now:1000}),/Không tìm/);assert.throws(()=>step(fresh(),{type:'select',slot:'4',id:'DEMO-TEST',now:1000}),/đã hết/)})
test('one product snapshot and price are locked in each order',()=>{const s=start();assert.equal(s.order.product.slot,'1');assert.equal(s.order.product.price,25000);assert.equal(s.order.expiresAt,91000);assert.throws(()=>step(s,{type:'create',id:'DUP',now:1000}));assert.throws(()=>step(s,{type:'select',slot:'2',id:'DEMO-TEST',now:1000}))})
test('dispense requires payment; success decrements exactly once',()=>{let s=ready();assert.throws(()=>step(s,{type:'dispense'}));s=step(s,{type:'paid'},2000);assert.throws(()=>step(s,{type:'cancel'}));s=step(s,{type:'dispense'});s=step(s,{type:'finish'});assert.equal(s.stage,'success');assert.equal(s.items.find(p=>p.slot==='1').stock,7);assert.equal(s.order.dispensed,true);assert.throws(()=>step(s,{type:'finish'}))})
test('QR expires at exact deadline and cannot accept normal payment after it',()=>{assert.equal(step(ready(),{type:'expire'},90999).stage,'qr');assert.equal(step(ready(),{type:'expire'},91000).stage,'expired');assert.equal(step(ready(),{type:'paid'},91000).stage,'expired')})
test('failed dispense retains paid order and never decrements inventory',()=>{let s=step(ready(),{type:'fail-dispense',value:true});s=step(s,{type:'paid'},2000);s=step(s,{type:'dispense'});s=step(s,{type:'finish'});assert.equal(s.stage,'dispense_error');assert.equal(s.order.paid,true);assert.equal(s.items[0].stock,8);assert.throws(()=>step(s,{type:'check'}));assert.throws(()=>step(s,{type:'paid'}))})
test('connection loss preserves order and blocks a new purchase until reconciliation',()=>{const s=step(ready(),{type:'offline'});assert.equal(s.order.id,'DEMO-TEST');assert.throws(()=>step(s,{type:'home'}));const checking=step(s,{type:'check'});assert.equal(step(checking,{type:'unpaid'},2000).stage,'qr');assert.equal(step(checking,{type:'unpaid'},100000).stage,'expired')})
test('late payment can be acknowledged only through explicit reconciliation',()=>{let s=step(ready(),{type:'expire'},100000);assert.throws(()=>step(s,{type:'paid'},100000));s=step(s,{type:'check'});s=step(s,{type:'paid'},100000);assert.equal(s.stage,'paid');assert.equal(s.order.paid,true)})
test('cancel retains reference; returning home clears current order',()=>{const s=step(ready(),{type:'cancel'});assert.equal(s.stage,'cancelled');assert.equal(s.order.id,'DEMO-TEST');assert.equal(step(s,{type:'home'}).order,null)})
test('reload preserves original deadline and expires offline time',()=>{const raw=JSON.stringify(ready());assert.equal(restore(raw,2000).order.expiresAt,91000);assert.equal(restore(raw,100000).stage,'expired')})
test('reload during dispensing never automatically repeats dispense',()=>{const s=step(step(ready(),{type:'paid'},2000),{type:'dispense'});const restored=restore(JSON.stringify(s),3000);assert.equal(restored.stage,'dispense_error');assert.equal(restored.order.paid,true);assert.throws(()=>step(restored,{type:'dispense'}))})
test('corrupt storage falls back safely and transitions do not mutate inputs',()=>{assert.deepEqual(restore('{invalid'),fresh());const initial=fresh();step(initial,{type:'select',slot:'1',id:'DEMO-TEST',now:1000});assert.equal(initial.stage,'catalog')})

test('one kiosk tap immediately creates payment without a detail confirmation',()=>{const s=start();assert.equal(s.stage,'creating');assert.equal(s.order.product.slot,'1');assert.equal(step(s,{type:'ready'},2000).stage,'qr');assert.throws(()=>step(s,{type:'select',slot:'2',id:'DUP',now:2000}))})
test('old intermediate detail session returns safely to kiosk catalog',()=>{const old={...fresh(),stage:'detail',selected:'1'};assert.equal(restore(JSON.stringify(old)).stage,'catalog')})

test('legacy slot migration preserves payment references and stock',()=>{
  const s=ready()
  s.items=s.items.map(p=>({...p,slot:String(Number(p.slot)+20)}))
  s.items[0].stock=3
  s.selected='21';s.order.product.slot='21'
  const restored=restore(JSON.stringify(s),2000)
  assert.equal(restored.stage,'qr')
  assert.equal(restored.order.id,'DEMO-TEST')
  assert.equal(restored.order.product.slot,'1')
  assert.equal(restored.selected,'1')
  assert.equal(restored.items[0].stock,3)
  assert.deepEqual(restored.items.map(p=>p.slot),['1','2','3','4','5','6'])
})
